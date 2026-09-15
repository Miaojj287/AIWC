/**
 * 定时任务 scheduler. Each enabled task holds one croner job; a fire (or 立即执行) creates a fresh
 * kernel thread on the 'cron' channel in the task's permission mode and runs the prompt to completion
 * with `kernel.runOnce`. The cron channel never asks: a call the mode does not cover is denied and the
 * model is told to report it, so the run's `denied` list says which mode the next run would need.
 *
 * Storage: <tasksDir>/tasks.json (definitions) and <tasksDir>/runs.jsonl (history, append-only,
 * compacted when it grows past RUNS_KEEP). Nothing here is UI copy — the renderer localizes
 * statuses; only the thread title comes from the host through `threadTitle`.
 */
import { Cron } from 'croner'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { appendFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ScheduledTaskInputSchema,
  type Event,
  type ScheduledTask,
  type ScheduledTaskInput,
  type TaskRun,
  type TaskSchedule,
  type TaskTemplate,
  type UserInput,
} from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'

export type TaskLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface TaskSchedulerDeps {
  dir: string
  kernel: Pick<Kernel, 'ensureThread' | 'runOnce' | 'events'>
  /** The user turn a run submits (electron/main/prompts/tasks.ts). */
  input: (task: ScheduledTask, firedAt: Date) => UserInput
  /** Title of the run's thread as shown in the Agent panel (localized by the host). */
  threadTitle: (task: ScheduledTask) => string
  templates?: readonly TaskTemplate[]
  onChanged?: (change: { reason: 'saved' | 'deleted' | 'toggled' | 'scheduled'; id: string }) => void
  onRun?: (run: TaskRun) => void
  logger?: TaskLogger
  now?: () => number
}

export interface TaskScheduler {
  list(): ScheduledTask[]
  get(id: string): { task: ScheduledTask; runs: TaskRun[] } | undefined
  save(input: ScheduledTaskInput): Promise<ScheduledTask>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask>
  /** Start a run now; resolves once the run has started (not finished). */
  runNow(id: string): Promise<TaskRun>
  cancel(id: string): boolean
  runs(opts?: { id?: string; limit?: number }): TaskRun[]
  templates(): TaskTemplate[]
  /** Arm every enabled task. Idempotent. */
  start(): void
  /** Disarm everything and abort in-flight runs. */
  stop(): void
}

/** Runs kept in memory and in runs.jsonl after compaction. */
export const RUNS_KEEP = 500
/** The agent's final message is stored capped; the transcript has the rest. */
export const SUMMARY_MAX_CHARS = 1_200
const PREVIEW_COUNT = 3
const TASKS_FILE = 'tasks.json'
const RUNS_FILE = 'runs.jsonl'

type StoredTask = Omit<ScheduledTask, 'nextRunAt' | 'running'> & {
  /** When the current schedule was set — interval tasks count from here, not from the last edit. */
  scheduleSince: number
}

interface TasksFile {
  version: 1
  tasks: StoredTask[]
}

/** croner (6-field, seconds first) pattern for the calendar kinds; interval is timer-driven. */
export function cronPatternFor(schedule: TaskSchedule): string | undefined {
  switch (schedule.kind) {
    case 'daily': {
      const [h, m] = schedule.time.split(':').map(Number)
      return `0 ${m} ${h} * * *`
    }
    case 'weekly': {
      const [h, m] = schedule.time.split(':').map(Number)
      const days = [...new Set(schedule.days)].sort((a, b) => a - b).join(',')
      return `0 ${m} ${h} * * ${days}`
    }
    case 'cron':
      return schedule.expression
    case 'interval':
      return undefined
  }
}

/** Next multiple of the interval after `now`, counted from `since`. */
export function nextIntervalAt(everyMinutes: number, since: number, now: number): number {
  const step = everyMinutes * 60_000
  if (now < since) return since
  const k = Math.floor((now - since) / step) + 1
  return since + k * step
}

export type SchedulePreview = { ok: true; next: number[] } | { ok: false; error: string }

/** The next `count` fire times of a schedule; `{ ok: false }` when a cron expression is invalid. */
export function previewSchedule(schedule: TaskSchedule, now: number, count = PREVIEW_COUNT): SchedulePreview {
  if (schedule.kind === 'interval') {
    const next: number[] = []
    let t = now
    for (let i = 0; i < count; i++) {
      t = nextIntervalAt(schedule.everyMinutes, now, t)
      next.push(t)
    }
    return { ok: true, next }
  }
  const pattern = cronPatternFor(schedule)
  if (!pattern) return { ok: false, error: 'unsupported schedule' }
  try {
    const job = new Cron(pattern, { paused: true })
    const runs = job.nextRuns(count, new Date(now)).map((d) => d.getTime())
    job.stop()
    if (runs.length === 0) return { ok: false, error: 'never fires' }
    return { ok: true, next: runs }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const sameSchedule = (a: TaskSchedule, b: TaskSchedule): boolean => JSON.stringify(a) === JSON.stringify(b)

const clip = (text: string, max: number): string => {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

export function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler {
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const tasksPath = join(deps.dir, TASKS_FILE)
  const runsPath = join(deps.dir, RUNS_FILE)

  const tasks = new Map<string, StoredTask>()
  let runs: TaskRun[] = []
  const jobs = new Map<string, Cron>()
  const active = new Map<string, { run: TaskRun; controller: AbortController }>()
  let started = false
  let writing: Promise<void> = Promise.resolve()

  // ---- persistence --------------------------------------------------------------------------------

  const load = (): void => {
    mkdirSync(deps.dir, { recursive: true })
    if (existsSync(tasksPath)) {
      try {
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as Partial<TasksFile>
        for (const raw of parsed.tasks ?? []) {
          const checked = ScheduledTaskInputSchema.safeParse(raw)
          if (!checked.success || !raw.id) {
            log('warn', 'tasks: dropping invalid task record', { id: raw.id })
            continue
          }
          tasks.set(raw.id, {
            ...checked.data,
            id: raw.id,
            createdAt: raw.createdAt ?? now(),
            updatedAt: raw.updatedAt ?? now(),
            scheduleSince: raw.scheduleSince ?? raw.updatedAt ?? now(),
            ...(raw.lastRunAt ? { lastRunAt: raw.lastRunAt } : {}),
            ...(raw.lastRunStatus ? { lastRunStatus: raw.lastRunStatus } : {}),
          })
        }
      } catch (e) {
        log('error', 'tasks: tasks.json unreadable', e)
      }
    }
    if (existsSync(runsPath)) {
      try {
        const lines = readFileSync(runsPath, 'utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const run = JSON.parse(line) as TaskRun
            if (run.id && run.taskId) runs.push(run.status === 'running' ? { ...run, status: 'failed' } : run)
          } catch {
            /* a torn last line after a crash */
          }
        }
        runs = runs.slice(-RUNS_KEEP)
      } catch (e) {
        log('error', 'tasks: runs.jsonl unreadable', e)
      }
    }
  }

  const persistTasks = (): Promise<void> => {
    const file: TasksFile = { version: 1, tasks: [...tasks.values()] }
    const body = JSON.stringify(file, null, 2)
    writing = writing.then(async () => {
      const tmp = `${tasksPath}.tmp`
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, tasksPath)
    })
    return writing.catch((e) => log('error', 'tasks: save failed', e))
  }

  const appendRun = (run: TaskRun): Promise<void> => {
    writing = writing.then(async () => {
      await appendFile(runsPath, `${JSON.stringify(run)}\n`, 'utf8')
    })
    return writing.catch((e) => log('error', 'tasks: run log append failed', e))
  }

  const compactRuns = (): Promise<void> => {
    runs = runs.slice(-RUNS_KEEP)
    const body = runs.map((r) => JSON.stringify(r)).join('\n') + (runs.length ? '\n' : '')
    writing = writing.then(async () => {
      const tmp = `${runsPath}.tmp`
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, runsPath)
    })
    return writing.catch((e) => log('error', 'tasks: run log compaction failed', e))
  }

  // ---- views ----------------------------------------------------------------------------------------

  const view = (stored: StoredTask): ScheduledTask => {
    const { scheduleSince: _since, ...rest } = stored
    const next = jobs.get(stored.id)?.nextRun()?.getTime()
    return {
      ...rest,
      ...(next ? { nextRunAt: next } : {}),
      ...(active.has(stored.id) ? { running: true } : {}),
    }
  }

  const require = (id: string): StoredTask => {
    const task = tasks.get(id)
    if (!task) throw new Error(`unknown task: ${id}`)
    return task
  }

  // ---- scheduling -----------------------------------------------------------------------------------

  const disarm = (id: string): void => {
    jobs.get(id)?.stop()
    jobs.delete(id)
  }

  const arm = (task: StoredTask): void => {
    disarm(task.id)
    if (!started || !task.enabled) return
    const fire = (): void => {
      // Interval jobs are one-shot timers: re-arm for the next slot before the run so nextRunAt stays visible.
      if (task.schedule.kind === 'interval') arm(task)
      void fireTask(task.id, 'schedule')
    }
    const opts = {
      protect: true,
      catch: (e: unknown) => log('error', 'tasks: scheduled fire threw', { id: task.id, error: String(e) }),
    }
    try {
      if (task.schedule.kind === 'interval') {
        const at = nextIntervalAt(task.schedule.everyMinutes, task.scheduleSince, now())
        jobs.set(task.id, new Cron(new Date(at), opts, fire))
      } else {
        const pattern = cronPatternFor(task.schedule)
        if (!pattern) return
        jobs.set(task.id, new Cron(pattern, opts, fire))
      }
    } catch (e) {
      log('warn', 'tasks: cannot arm task', { id: task.id, error: String(e) })
    }
  }

  // ---- running --------------------------------------------------------------------------------------

  const recordRunUpdate = (run: TaskRun): void => {
    const idx = runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) runs[idx] = run
    else runs.push(run)
    deps.onRun?.(run)
  }

  const fireTask = async (id: string, trigger: TaskRun['trigger']): Promise<TaskRun> => {
    const task = tasks.get(id)
    if (!task) throw new Error(`unknown task: ${id}`)
    const startedAt = now()
    const current = active.get(id)
    if (current) {
      if (trigger === 'manual') return current.run
      const skipped: TaskRun = {
        id: randomUUID(),
        taskId: id,
        trigger,
        status: 'skipped',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        denied: [],
        toolCalls: 0,
      }
      recordRunUpdate(skipped)
      void appendRun(skipped)
      log('info', 'tasks: previous run still going, skipped', { id })
      return skipped
    }

    const run: TaskRun = {
      id: randomUUID(),
      taskId: id,
      trigger,
      status: 'running',
      startedAt,
      denied: [],
      toolCalls: 0,
    }
    const controller = new AbortController()
    active.set(id, { run, controller })
    recordRunUpdate(run)
    deps.onChanged?.({ reason: 'scheduled', id })

    // Runs finish in the background; the caller only waits for the thread to exist.
    void execute(task, run, controller)
    return run
  }

  const execute = async (task: StoredTask, run: TaskRun, controller: AbortController): Promise<void> => {
    let off: (() => void) | undefined
    try {
      const threadId = await deps.kernel.ensureThread(
        { channel: 'cron' },
        {
          profile: 'cron',
          permissionMode: task.permissionMode,
          allowAlways: [],
          ...(task.model ? { model: task.model } : {}),
          title: deps.threadTitle(view(task)),
        },
      )
      run.threadId = threadId
      recordRunUpdate({ ...run })
      off = deps.kernel.events.on((e: Event) => {
        if (e.type !== 'tool.call' || e.threadId !== threadId) return
        if (e.status === 'running') run.toolCalls += 1
        else if (e.status === 'denied' && !run.denied.some((d) => d.key === (e.allowKey ?? e.toolName)))
          run.denied.push({ tool: e.toolName, key: e.allowKey ?? e.toolName, risk: e.risk, summary: e.summary })
      })
      const result = await deps.kernel.runOnce(threadId, deps.input(view(task), new Date(run.startedAt)), {
        signal: controller.signal,
      })
      run.status = 'done'
      run.summary = clip(result.text, SUMMARY_MAX_CHARS)
    } catch (e) {
      const err = e as Error & { text?: string }
      run.status = controller.signal.aborted ? 'cancelled' : 'failed'
      run.error = err?.message ?? String(e)
      if (err?.text) run.summary = clip(err.text, SUMMARY_MAX_CHARS)
      log(run.status === 'cancelled' ? 'info' : 'warn', `tasks: run ${run.status}`, { id: task.id, error: run.error })
    } finally {
      off?.()
      run.finishedAt = now()
      run.durationMs = run.finishedAt - run.startedAt
      active.delete(task.id)
      const stored = tasks.get(task.id)
      if (stored) {
        stored.lastRunAt = run.startedAt
        stored.lastRunStatus = run.status
        void persistTasks()
      }
      recordRunUpdate({ ...run })
      await appendRun(run)
      if (runs.length > RUNS_KEEP * 2) await compactRuns()
      deps.onChanged?.({ reason: 'scheduled', id: task.id })
    }
  }

  load()

  return {
    list: () => [...tasks.values()].map(view).sort((a, b) => b.updatedAt - a.updatedAt),

    get(id) {
      const task = tasks.get(id)
      if (!task) return undefined
      return { task: view(task), runs: this.runs({ id, limit: 20 }) }
    },

    async save(input) {
      const data = ScheduledTaskInputSchema.parse(input)
      const at = now()
      const existing = data.id ? tasks.get(data.id) : undefined
      const id = existing?.id ?? data.id ?? randomUUID()
      const preview = previewSchedule(data.schedule, at, 1)
      if (!preview.ok) throw new Error(`invalid schedule: ${preview.error}`)
      const stored: StoredTask = {
        ...(existing ?? { createdAt: at }),
        ...data,
        id,
        updatedAt: at,
        scheduleSince: existing && sameSchedule(existing.schedule, data.schedule) ? existing.scheduleSince : at,
      }
      tasks.set(id, stored)
      arm(stored)
      await persistTasks()
      deps.onChanged?.({ reason: 'saved', id })
      return view(stored)
    },

    async remove(id) {
      const task = tasks.get(id)
      if (!task) return
      this.cancel(id)
      disarm(id)
      tasks.delete(id)
      await persistTasks()
      deps.onChanged?.({ reason: 'deleted', id })
    },

    async setEnabled(id, enabled) {
      const task = require(id)
      if (task.enabled !== enabled) {
        task.enabled = enabled
        task.updatedAt = now()
        arm(task)
        await persistTasks()
        deps.onChanged?.({ reason: 'toggled', id })
      }
      return view(task)
    },

    runNow: (id) => fireTask(id, 'manual'),

    cancel(id) {
      const current = active.get(id)
      if (!current) return false
      current.controller.abort()
      return true
    },

    runs(opts = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), RUNS_KEEP)
      const list = opts.id ? runs.filter((r) => r.taskId === opts.id) : runs
      return list.slice(-limit).reverse()
    },

    templates: () => [...(deps.templates ?? [])],

    start() {
      if (started) return
      started = true
      for (const task of tasks.values()) arm(task)
      log('info', 'tasks: scheduler started', { tasks: tasks.size, armed: jobs.size })
    },

    stop() {
      started = false
      for (const id of [...jobs.keys()]) disarm(id)
      for (const { controller } of active.values()) controller.abort()
    },
  }
}
