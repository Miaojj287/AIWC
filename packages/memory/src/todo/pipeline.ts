/**
 * createTodoScanner — the 每日待办 scan and its schedule.
 *
 * scan():
 *   选材  for every picked chat: the newest ≤ cap readable messages after its cursor (never older than
 *         MAX_LOOKBACK_MS); a chat with nothing new costs no model call
 *   整理  one bounded model call per chat (concurrency 3) → merged day summary + todos citing messages
 *   保存  new todos (de-duplicated per chat), the day's summaries, the cursors of the chats that succeeded
 * A chat whose call fails keeps its cursor, so the next scan reads those messages again. The model is
 * resolved once per scan from config (unset = the default model); no model → the scan fails before any
 * message leaves the substrate. Only one scan runs at a time; cancel() discards the running one.
 *
 * start()/reschedule()/stop(): a croner job from `config().schedule` (every N hours on the hour / daily at
 * HH:mm / none for 仅手动) while enabled with at least one chat, plus one catch-up scan shortly after start
 * when the last scan is older than the most recent scheduled time.
 */
import {
  todoDateOf,
  type Millis,
  type ModelClient,
  type ModelSelection,
  type SubstrateService,
  type TodoChatSummary,
  type TodoConfig,
  type TodoProgress,
  type TodoScanFailure,
  type TodoScanResult,
  type TodoScanTrigger,
  type TodoSchedule,
  type TodoStatus,
  type WxSession,
} from '@aiwc/protocol'
import { Cron } from 'croner'
import { ModelSampleError, generateValidated, mapConcurrent } from '../internal/model'
import { truncateChars } from '../internal/text'
import { cleanScanOutput, scanSystem, scanUser, ScanOutputSchema } from './prompts'
import {
  collectSourceMessages,
  messageRef,
  renderMessages,
  scanWindowStart,
  windowLabel,
  type SourceCursor,
  type SourceMaterial,
} from './select'
import type { ScannedTodo, TodoScanState, TodoStore } from './todoStore'

const SCAN_CONCURRENCY = 3
const SCAN_MAX_OUTPUT_TOKENS = 1200
/** Catch-up waits for the substrate to finish its startup sync instead of racing it. */
export const CATCH_UP_DELAY_MS = 60_000
const DETAIL_MAX = 300

type Logger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface TodoScannerDeps {
  substrate: SubstrateService
  store: TodoStore
  /** Resolve the scan's model; throws when none is configured (→ failure 'model_unavailable'). */
  model: (selection: ModelSelection | undefined) => Promise<ModelClient>
  config: () => TodoConfig
  /** A scan finished (any trigger) — the host broadcasts and decides whether to toast. */
  onScanned?: (result: TodoScanResult) => void
  onProgress?: (progress: TodoProgress) => void
  now?: () => Millis
  logger?: Logger
}

export interface TodoScanner {
  scan(opts?: { trigger?: TodoScanTrigger; sourceIds?: readonly string[] }): Promise<TodoScanResult>
  /** Abort the running scan; false when none is running. */
  cancel(): boolean
  status(): Promise<TodoStatus>
  /** Arm the schedule and queue the catch-up check. */
  start(): void
  /** Re-arm after a config change (enabled / chats / schedule); never starts a scan by itself. */
  reschedule(): void
  /** Disarm, drop the pending catch-up and abort a running scan (shutdown). */
  stop(): void
  /** The catch-up check start() queues, callable directly (tests). */
  runCatchUp(): Promise<TodoScanResult | undefined>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** croner pattern (with seconds) for a schedule; undefined for 仅手动. */
export function cronPattern(schedule: TodoSchedule): string | undefined {
  switch (schedule.kind) {
    case 'hourly':
      return schedule.everyHours === 1 ? '0 0 * * * *' : `0 0 */${schedule.everyHours} * * *`
    case 'daily': {
      const [h, m] = schedule.time.split(':').map(Number)
      return `0 ${m ?? 0} ${h ?? 0} * * *`
    }
    case 'manual':
      return undefined
  }
}

/** The most recent time the schedule fired at or before `now`; undefined for 仅手动. */
export function previousFireAt(schedule: TodoSchedule, now: Millis): Millis | undefined {
  const d = new Date(now)
  switch (schedule.kind) {
    case 'hourly':
      d.setMinutes(0, 0, 0)
      d.setHours(d.getHours() - (d.getHours() % schedule.everyHours))
      return d.getTime()
    case 'daily': {
      const [h, m] = schedule.time.split(':').map(Number)
      d.setHours(h ?? 0, m ?? 0, 0, 0)
      if (d.getTime() > now) d.setDate(d.getDate() - 1)
      return d.getTime()
    }
    case 'manual':
      return undefined
  }
}

interface ChatOutcome {
  sourceId: string
  cursor?: SourceCursor
  summary?: TodoChatSummary
  todos: ScannedTodo[]
  messages: number
  failed: boolean
  error?: string
}

export function createTodoScanner(deps: TodoScannerDeps): TodoScanner {
  const now = deps.now ?? (() => Date.now())
  const log: Logger = deps.logger ?? (() => {})
  let cron: Cron | undefined
  let catchUpTimer: ReturnType<typeof setTimeout> | undefined
  let running: { controller: AbortController; promise: Promise<TodoScanResult> } | undefined

  const result = (
    trigger: TodoScanTrigger,
    startedAt: Millis,
    fields: Partial<Omit<TodoScanResult, 'trigger' | 'startedAt' | 'finishedAt'>>,
  ): TodoScanResult => ({
    ok: false,
    scanned: 0,
    failed: 0,
    messages: 0,
    added: 0,
    ...fields,
    trigger,
    startedAt,
    finishedAt: now(),
  })

  const failure = (trigger: TodoScanTrigger, startedAt: Millis, code: TodoScanFailure, detail?: string) =>
    result(trigger, startedAt, { failure: code, ...(detail ? { detail: truncateChars(detail, DETAIL_MAX) } : {}) })

  async function scanChat(
    model: ModelClient,
    source: { id: string; title: string },
    state: TodoScanState,
    today: string,
    startedAt: Millis,
    signal: AbortSignal,
  ): Promise<ChatOutcome> {
    const cfg = deps.config()
    const live: WxSession | undefined = await deps.substrate.getSession(source.id)
    const session = { id: source.id, title: live?.title || source.title || source.id, kind: live?.kind ?? 'group' }
    const cursor = state.cursors[source.id]
    const from = scanWindowStart(cursor, cfg.schedule, startedAt)
    const material: SourceMaterial = await collectSourceMessages(deps.substrate, session, {
      ...(cursor ? { cursor } : {}),
      from,
      cap: cfg.maxMessagesPerSource,
    })
    const base = { sourceId: source.id, ...(material.next ? { cursor: material.next } : {}) }
    if (material.messages.length === 0) return { ...base, todos: [], messages: 0, failed: false }

    const first = material.messages[0]
    const last = material.messages[material.messages.length - 1]
    const windowFrom = first?.createdAt ?? from
    const windowTo = last?.createdAt ?? startedAt
    const previous = (await deps.store.getDay(today))?.chats.find((c) => c.sourceId === source.id)
    const known = (await deps.store.list()).filter((i) => !i.done && i.sourceId === source.id).map((i) => i.text)
    const window = windowLabel(windowFrom, windowTo)
    try {
      const output = await generateValidated(
        model,
        {
          label: session.title,
          system: scanSystem({ title: session.title, kind: session.kind, window }),
          user: scanUser({
            title: session.title,
            kind: session.kind,
            window,
            count: material.messages.length,
            truncated: material.truncated,
            ...(previous?.summary ? { previousSummary: previous.summary } : {}),
            knownTodos: known,
            transcript: renderMessages(material.messages),
          }),
          signal,
          maxOutputTokens: SCAN_MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        },
        ScanOutputSchema,
      )
      const clean = cleanScanOutput(output)
      const byRef = new Map(material.messages.map((m, i) => [messageRef(i), m]))
      const todos: ScannedTodo[] = clean.todos.map((todo) => {
        const cited = todo.ref ? byRef.get(todo.ref) : undefined
        return {
          text: todo.text,
          sourceId: source.id,
          sourceTitle: session.title,
          ...(todo.due ? { due: todo.due } : {}),
          ...(cited ? { messageId: cited.id, messageAt: cited.createdAt } : {}),
        }
      })
      const summary: TodoChatSummary | undefined = clean.summary
        ? {
            sourceId: source.id,
            title: session.title,
            summary: clean.summary,
            messageCount: (previous?.messageCount ?? 0) + material.messages.length,
            from: Math.min(previous?.from ?? windowFrom, windowFrom),
            to: windowTo,
            updatedAt: now(),
          }
        : undefined
      return { ...base, todos, messages: material.messages.length, failed: false, ...(summary ? { summary } : {}) }
    } catch (e) {
      if (signal.aborted) throw e
      log('warn', 'todo: chat scan failed', { error: errText(e) })
      // Keep the old cursor: these messages are read again by the next scan.
      return failedChat(source.id, e)
    }
  }

  /** Provider errors are shown as they are (data); a parse failure carries no detail (its text is not UI copy). */
  function failedChat(sourceId: string, e: unknown): ChatOutcome {
    return {
      sourceId,
      todos: [],
      messages: 0,
      failed: true,
      ...(e instanceof ModelSampleError ? { error: e.message } : {}),
    }
  }

  async function runScan(
    trigger: TodoScanTrigger,
    sourceIds: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<{ result: TodoScanResult; cursors?: TodoScanState['cursors'] }> {
    const startedAt = now()
    const cfg = deps.config()
    const sources = sourceIds ? cfg.sources.filter((s) => sourceIds.includes(s.id)) : cfg.sources
    if (deps.substrate.status().connection !== 'ready')
      return { result: failure(trigger, startedAt, 'substrate_unavailable') }

    let model: ModelClient
    try {
      model = await deps.model(cfg.model)
    } catch (e) {
      return { result: failure(trigger, startedAt, 'model_unavailable', errText(e)) }
    }

    const state = await deps.store.readState()
    const today = todoDateOf(startedAt)
    deps.onProgress?.({ step: 'collect', done: 0, total: sources.length })
    let finished = 0
    const outcomes = await mapConcurrent(sources, SCAN_CONCURRENCY, async (source) => {
      try {
        return await scanChat(model, source, state, today, startedAt, signal)
      } catch (e) {
        if (signal.aborted) throw e
        log('warn', 'todo: reading a chat failed', { error: errText(e) })
        return failedChat(source.id, e)
      } finally {
        finished++
        deps.onProgress?.({ step: 'summarize', done: finished, total: sources.length, source: source.title })
      }
    })
    if (signal.aborted) return { result: failure(trigger, startedAt, 'cancelled') }

    deps.onProgress?.({ step: 'save', done: sources.length, total: sources.length })
    const done = outcomes.filter((o): o is ChatOutcome => o !== undefined)
    const added = await deps.store.addScanned(done.flatMap((o) => o.todos))
    await deps.store.mergeDay(
      today,
      done.flatMap((o) => (o.summary ? [o.summary] : [])),
    )
    const cursors = { ...state.cursors }
    for (const o of done) if (!o.failed && o.cursor) cursors[o.sourceId] = o.cursor
    const failed = sources.length - done.filter((o) => !o.failed).length
    const scanned = sources.length - failed
    const firstError = done.find((o) => o.error)?.error
    return {
      cursors,
      result: result(trigger, startedAt, {
        ok: scanned > 0,
        ...(scanned === 0 ? { failure: 'failed' as const } : {}),
        ...(firstError ? { detail: truncateChars(firstError, DETAIL_MAX) } : {}),
        scanned,
        failed,
        messages: done.reduce((n, o) => n + o.messages, 0),
        added: added.length,
      }),
    }
  }

  const scanner: TodoScanner = {
    async scan(opts = {}) {
      const trigger = opts.trigger ?? 'manual'
      const startedAt = now()
      const cfg = deps.config()
      if (!cfg.enabled) return failure(trigger, startedAt, 'disabled')
      if (cfg.sources.length === 0) return failure(trigger, startedAt, 'no_sources')
      if (running) return failure(trigger, startedAt, 'busy')
      const controller = new AbortController()
      const promise = (async (): Promise<TodoScanResult> => {
        try {
          const run = await runScan(trigger, opts.sourceIds, controller.signal)
          // A cancelled scan changes nothing on disk; the previous result stays the last one.
          if (run.result.failure !== 'cancelled') {
            const state = await deps.store.readState()
            await deps.store.writeState({ cursors: run.cursors ?? state.cursors, last: run.result })
          }
          return run.result
        } catch (e) {
          return controller.signal.aborted
            ? failure(trigger, startedAt, 'cancelled')
            : failure(trigger, startedAt, 'failed', errText(e))
        }
      })()
      running = { controller, promise }
      try {
        const final = await promise
        deps.onScanned?.(final)
        return final
      } finally {
        running = undefined
      }
    },

    cancel() {
      if (!running) return false
      running.controller.abort()
      return true
    },

    async status() {
      const cfg = deps.config()
      const { last } = await deps.store.readState()
      const next = cron?.nextRun()
      return {
        enabled: cfg.enabled,
        sources: cfg.sources.length,
        running: running !== undefined,
        ...(last ? { last } : {}),
        ...(next ? { nextRunAt: next.getTime() } : {}),
      }
    },

    async runCatchUp() {
      const cfg = deps.config()
      if (!cfg.enabled || cfg.sources.length === 0) return undefined
      const due = previousFireAt(cfg.schedule, now())
      if (due === undefined) return undefined
      const { last } = await deps.store.readState()
      if (last && last.startedAt >= due) return undefined
      return scanner.scan({ trigger: 'catch_up' })
    },

    start() {
      scanner.reschedule()
      if (catchUpTimer) clearTimeout(catchUpTimer)
      catchUpTimer = setTimeout(() => {
        catchUpTimer = undefined
        scanner.runCatchUp().catch((e: unknown) => log('error', 'todo: catch-up scan threw', { error: errText(e) }))
      }, CATCH_UP_DELAY_MS)
    },

    reschedule() {
      cron?.stop()
      cron = undefined
      const cfg = deps.config()
      const pattern = cfg.enabled && cfg.sources.length > 0 ? cronPattern(cfg.schedule) : undefined
      if (!pattern) return
      cron = new Cron(
        pattern,
        { protect: true, catch: (e) => log('error', 'todo: scheduled scan threw', { error: errText(e) }) },
        async () => {
          const r = await scanner.scan({ trigger: 'schedule' })
          if (!r.ok) log('warn', 'todo: scheduled scan did not finish', { failure: r.failure })
        },
      )
    },

    stop() {
      cron?.stop()
      cron = undefined
      if (catchUpTimer) clearTimeout(catchUpTimer)
      catchUpTimer = undefined
      running?.controller.abort()
    },
  }
  return scanner
}
