/**
 * 自动写入记忆 (设置 › 记忆): when a desktop Agent conversation has been idle for a while, distil what the owner
 * said about themselves into proposals for the 待确认 list. Nothing is written to a memory file here.
 *
 *  - only desktop chat threads (not persona / cron / WeChat bot / child threads), and only messages after the
 *    thread's watermark, so a conversation is never distilled twice
 *  - the thread's own model (a local thread never falls back to an online one — `model()` decides), one call
 *    at a time, cancellable, with a deadline; a failed run leaves the watermark alone and retries next idle
 *  - off whenever `enabled()` is false (checked when the timer fires, so turning it off stops pending runs)
 */
import { asThreadId, type Event, type MemoryStore, type ModelClient, type ModelSelection } from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'
import { extractMemoryProposals, renderReviewTranscript, type MemoryProposalStore } from '@aiwc/memory'

type PkgLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

/** Quiet time after the last completed turn before a conversation counts as finished. */
export const MEMORY_EXTRACTION_IDLE_MS = 10 * 60_000
/** New owner text below this is not worth a model call (「好的」「谢谢」). */
const MIN_NEW_USER_CHARS = 12
/** Startup catch-up: conversations that went idle while the app was closed, newest first. */
const CATCH_UP_LIMIT = 3
const CATCH_UP_WINDOW_MS = 24 * 60 * 60_000

export interface MemoryExtractorDeps {
  kernel: Pick<Kernel, 'events' | 'getThread' | 'listThreads'>
  proposals: Pick<MemoryProposalStore, 'add' | 'list' | 'extractedCount' | 'markExtracted'>
  memory: Pick<MemoryStore, 'entries'>
  /** 设置 › 记忆 › 自动写入记忆. */
  enabled(): boolean
  /** The client for a thread's model selection, at the lowest reasoning effort; throws when unavailable. */
  model(selection: ModelSelection | undefined): Promise<ModelClient>
  /** Injectable for tests. */
  extract?: typeof extractMemoryProposals
  idleMs?: number
  now?: () => number
  logger: PkgLogger
}

export interface MemoryExtractor {
  /** Queue recently idle conversations missed while the app was closed. */
  catchUp(): Promise<void>
  /** Distil one thread now (tests, and the idle timer); resolves with the number of proposals added. */
  run(threadId: string): Promise<number>
  dispose(): void
}

export function createMemoryExtractor(deps: MemoryExtractorDeps): MemoryExtractor {
  const idleMs = deps.idleMs ?? MEMORY_EXTRACTION_IDLE_MS
  const now = deps.now ?? (() => Date.now())
  const extract = deps.extract ?? extractMemoryProposals
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const queue: string[] = []
  let draining = false
  let disposed = false
  let inFlight: AbortController | undefined

  const clear = (threadId: string) => {
    const timer = timers.get(threadId)
    if (timer) clearTimeout(timer)
    timers.delete(threadId)
  }

  const enqueue = (threadId: string) => {
    if (disposed || queue.includes(threadId)) return
    queue.push(threadId)
    void drain()
  }

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (!disposed && queue.length > 0) {
        const threadId = queue.shift() as string
        await run(threadId).catch((e: unknown) => deps.logger('warn', 'memory extraction failed', e))
      }
    } finally {
      draining = false
    }
  }

  async function run(threadId: string): Promise<number> {
    if (disposed || !deps.enabled()) return 0
    const thread = await deps.kernel.getThread(asThreadId(threadId))
    if (!thread || thread.running) return 0
    const { record, items } = thread
    if (record.origin.channel !== 'desktop' || record.settings.profile !== 'desktop-chat') return 0
    const seen = deps.proposals.extractedCount(threadId)
    const view = renderReviewTranscript(items, seen)
    if (view.newUserMessages === 0 || view.newUserChars < MIN_NEW_USER_CHARS) {
      if (view.userMessages > seen) await deps.proposals.markExtracted(threadId, view.userMessages)
      return 0
    }
    const [memoryEntries, userEntries] = await Promise.all([deps.memory.entries('MEMORY'), deps.memory.entries('USER')])
    const existing = [...memoryEntries, ...userEntries]
      .map((e) => e.text)
      .concat(deps.proposals.list().map((p) => p.text))
    const controller = new AbortController()
    inFlight = controller
    try {
      const model = await deps.model(record.settings.model)
      const found = await extract(model, { transcript: view.transcript, existing }, { signal: controller.signal })
      let added = 0
      for (const p of found) {
        const r = await deps.proposals.add({
          file: p.file,
          text: p.text,
          origin: 'extraction',
          threadId,
          ...(record.title ? { threadTitle: record.title } : {}),
        })
        if (r.ok) added++
        else if (r.reason === 'full') break
      }
      await deps.proposals.markExtracted(threadId, view.userMessages)
      deps.logger('info', 'memory extraction finished', { threadId, proposed: found.length, added })
      return added
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }

  const onEvent = (e: Event) => {
    if (e.type === 'turn.started') clear(e.threadId)
    else if (e.type === 'turn.completed') {
      clear(e.threadId)
      timers.set(
        e.threadId,
        setTimeout(() => {
          timers.delete(e.threadId)
          enqueue(e.threadId)
        }, idleMs),
      )
    }
  }
  const off = deps.kernel.events.on(onEvent)

  return {
    async catchUp() {
      if (!deps.enabled()) return
      const recent = await deps.kernel.listThreads({ channel: 'desktop', limit: 10, nonEmpty: true })
      const t = now()
      recent
        .filter((r) => t - r.updatedAt >= idleMs && t - r.updatedAt <= CATCH_UP_WINDOW_MS)
        .slice(0, CATCH_UP_LIMIT)
        .forEach((r) => enqueue(r.threadId))
    },
    run,
    dispose() {
      disposed = true
      off()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      queue.length = 0
      inFlight?.abort()
    },
  }
}
