/**
 * 定时任务 scheduler. taskTicker.ts wakes at the soonest due slot; a slot that is due fires a run, a slot that passed
 * while the app was closed or the machine asleep is recorded as missed (with why) and, under the task's catch-up
 * policy, run once late. A run creates a fresh kernel thread on the 'cron' channel in the task's permission mode and
 * runs the prompt to completion with `kernel.runOnce` (a reminder task only notifies, no model). The cron channel
 * never asks: a call the mode does not cover is denied and reported. A run that failed on a rate limit or the network
 * without changing anything is tried again later (taskRecovery.ts); a run the app quit during is `interrupted`.
 *
 * Storage is taskFiles.ts. Nothing here is UI copy — the renderer localizes statuses and reasons; only the thread
 * title comes from the host through `threadTitle`.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  ScheduledTaskInputSchema,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type TaskRun,
  type TaskTemplate,
  type UserInput,
} from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'
import { runArtifacts } from './taskArtifacts'
import { createTaskFiles, HEARTBEAT_FILE, RUNS_KEEP, type StoredTask } from './taskFiles'
import {
  catchUpDecision,
  LATE_GRACE_MS,
  MAX_TASK_RETRIES,
  missedReason,
  reasonForRunError,
  shouldRetryRun,
  taskRetryDelayMs,
} from './taskRecovery'
import { watchRun, type RunWatch } from './taskRunWatch'
import { createTaskTicker, defaultSetTimer, type SetTimer } from './taskTicker'
import { missedSlots, nextFireAt, previewSchedule } from './taskTiming'

export { cronPatternFor, nextIntervalAt, previewSchedule } from './taskTiming'

export type TaskLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface TaskSchedulerDeps {
  dir: string
  kernel: Pick<Kernel, 'ensureThread' | 'runOnce' | 'events'>
  /** The user turn a run submits (electron/main/prompts/tasks.ts). */
  input: (task: ScheduledTask, firedAt: Date) => UserInput
  /** Title of the run's thread as shown in the Agent panel (localized by the host). */
  threadTitle: (task: ScheduledTask) => string
  /** Delivers a `remind` task (notification, toast, a note in its source thread). */
  remind?: (task: ScheduledTask) => Promise<void>
  templates?: readonly TaskTemplate[]
  onChanged?: (change: { reason: 'saved' | 'deleted' | 'toggled' | 'scheduled'; id: string }) => void
  onRun?: (run: TaskRun) => void
  logger?: TaskLogger
  now?: () => number
  /** Timer factory (tests drive the clock through it). */
  setTimer?: SetTimer
}

export interface TaskScheduler {
  list(): ScheduledTask[]
  get(id: string): { task: ScheduledTask; runs: TaskRun[] } | undefined
  save(input: ScheduledTaskDraft): Promise<ScheduledTask>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask>
  /** Start a run now; resolves once the run has started (not finished). */
  runNow(id: string): Promise<TaskRun>
  cancel(id: string): boolean
  runs(opts?: { id?: string; limit?: number }): TaskRun[]
  templates(): TaskTemplate[]
  /** Arm every enabled task and look for slots missed since the last session. Idempotent. */
  start(): void
  /** Disarm everything and abort in-flight runs (they are recorded as interrupted). */
  stop(): void
  /** Resolves once queued task / run writes have reached disk; await it before quitting or reopening the folder. */
  flush(): Promise<void>
}

/** The agent's final message is stored capped; the transcript has the rest. */
export const SUMMARY_MAX_CHARS = 1_200

type RunExtra = Partial<Pick<TaskRun, 'reason' | 'scheduledFor' | 'missedCount' | 'attempt' | 'maxAttempts'>>

const sameSchedule = (a: StoredTask['schedule'], b: StoredTask['schedule']): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const clip = (text: string, max: number): string => {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

export function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler {
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? defaultSetTimer
  const files = createTaskFiles(deps.dir, now, log)

  const tasks = new Map<string, StoredTask>()
  /** Next due slot of every armed task. */
  const due = new Map<string, number>()
  const active = new Map<string, { run: TaskRun; controller: AbortController }>()
  /** Pending retry timers per task. */
  const retries = new Map<string, () => void>()
  let started = false
  let stopping = false
  /** Last moment the app was known to be running: a missed slot after it means the app was closed. */
  let aliveAt: number | undefined

  for (const task of files.loadTasks()) tasks.set(task.id, task)
  const loaded = files.loadRuns()
  let runs: TaskRun[] = loaded.runs
  if (loaded.interrupted > 0) {
    for (const run of runs) {
      const task = tasks.get(run.taskId)
      if (run.status === 'interrupted' && task && (task.lastRunAt ?? 0) <= run.startedAt) {
        task.lastRunAt = run.startedAt
        task.lastRunStatus = 'interrupted'
      }
    }
    void files.compactRuns(runs)
    void files.persistTasks([...tasks.values()])
  }

  const persistTasks = (): Promise<void> => files.persistTasks([...tasks.values()])

  // ---- views ----------------------------------------------------------------------------------------

  const view = (stored: StoredTask): ScheduledTask => {
    const { scheduleSince: _since, lastSlotAt: _slot, ...rest } = stored
    const next = due.get(stored.id)
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

  /** Plan the task's next slot after `from`. */
  const arm = (task: StoredTask, from: number = now()): void => {
    const next = started && task.enabled ? nextFireAt(task.schedule, task.scheduleSince, from) : undefined
    if (next === undefined) due.delete(task.id)
    else due.set(task.id, next)
  }

  /** A one-shot task has had its slot: it switches itself off. */
  const finishOneShot = (task: StoredTask): void => {
    if (task.schedule.kind !== 'once') return
    task.enabled = false
    due.delete(task.id)
  }

  const onWake = (at: number, sleptFrom: number | undefined): void => {
    let changed = false
    for (const [id, slot] of [...due]) {
      if (slot > at) continue
      const task = tasks.get(id)
      if (!task) {
        due.delete(id)
        continue
      }
      changed = true
      if (at - slot <= LATE_GRACE_MS) {
        task.lastSlotAt = slot
        arm(task, at)
        finishOneShot(task)
        void fireTask(id, 'schedule', { scheduledFor: slot })
        continue
      }
      const missed = missedSlots(task.schedule, task.scheduleSince, slot - 1, at)
      const latest = missed.latest ?? slot
      const extra: RunExtra = {
        reason: missedReason(latest, aliveAt, sleptFrom),
        scheduledFor: latest,
        missedCount: Math.max(1, missed.count),
      }
      task.lastSlotAt = latest
      arm(task, at)
      finishOneShot(task)
      if (catchUpDecision(task, { count: missed.count, latest }, at) === 'run') void fireTask(id, 'catch_up', extra)
      else recordMissed(task, extra)
    }
    aliveAt = at
    if (changed) void persistTasks()
  }

  const ticker = createTaskTicker({
    now,
    nextDue: () => (due.size ? Math.min(...due.values()) : undefined),
    onWake,
    heartbeatPath: join(deps.dir, HEARTBEAT_FILE),
    setTimer: deps.setTimer,
    logger: log,
  })

  const cancelRetry = (id: string): void => {
    retries.get(id)?.()
    retries.delete(id)
  }

  // ---- running --------------------------------------------------------------------------------------

  const recordRunUpdate = (run: TaskRun): void => {
    const idx = runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) runs[idx] = run
    else runs.push(run)
    deps.onRun?.(run)
  }

  const instantRun = (task: StoredTask, trigger: TaskRun['trigger'], status: TaskRun['status'], extra: RunExtra) => {
    const at = now()
    const run: TaskRun = {
      id: randomUUID(),
      taskId: task.id,
      trigger,
      status,
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      denied: [],
      toolCalls: 0,
      ...extra,
    }
    recordRunUpdate(run)
    void files.appendRun(run)
    return run
  }

  const recordMissed = (task: StoredTask, extra: RunExtra): void => {
    const run = instantRun(task, 'schedule', 'missed', extra)
    task.lastRunAt = run.startedAt
    task.lastRunStatus = 'missed'
    log('info', 'tasks: slot missed', { id: task.id, reason: extra.reason, count: extra.missedCount })
    deps.onChanged?.({ reason: 'scheduled', id: task.id })
  }

  const fireTask = async (id: string, trigger: TaskRun['trigger'], extra: RunExtra = {}): Promise<TaskRun> => {
    const task = tasks.get(id)
    if (!task) throw new Error(`unknown task: ${id}`)
    const current = active.get(id)
    if (current) {
      if (trigger === 'manual') return current.run
      log('info', 'tasks: previous run still going, skipped', { id })
      return instantRun(task, trigger, 'skipped', { ...extra, reason: 'previous_running' })
    }
    if (trigger !== 'retry') cancelRetry(id)

    const run: TaskRun = {
      id: randomUUID(),
      taskId: id,
      trigger,
      status: 'running',
      startedAt: now(),
      denied: [],
      toolCalls: 0,
      ...extra,
    }
    const controller = new AbortController()
    active.set(id, { run, controller })
    recordRunUpdate(run)
    // Written now so a crash mid-run is found at the next launch and shown as interrupted.
    void files.appendRun(run)
    deps.onChanged?.({ reason: 'scheduled', id })

    // Runs finish in the background; the caller only waits for the thread to exist.
    void execute(task, run, controller)
    return run
  }

  const runAgent = async (task: StoredTask, run: TaskRun, signal: AbortSignal, watch: (w: RunWatch) => void) => {
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
    watch(watchRun(deps.kernel.events, threadId, run))
    const result = await deps.kernel.runOnce(threadId, deps.input(view(task), new Date(run.startedAt)), { signal })
    run.summary = clip(result.text, SUMMARY_MAX_CHARS)
    run.artifacts = runArtifacts(result.artifacts)
    // A run that produced nothing is not a success, whatever the turn said.
    if (result.text.trim()) run.status = 'done'
    else Object.assign(run, { status: 'failed', reason: 'empty_result' })
  }

  const scheduleRetry = (task: StoredTask, run: TaskRun, retryAfterMs: number | undefined): void => {
    const attempt = (run.attempt ?? 0) + 1
    const delay = taskRetryDelayMs(attempt, retryAfterMs)
    run.retryAt = now() + delay
    run.maxAttempts = MAX_TASK_RETRIES
    cancelRetry(task.id)
    retries.set(
      task.id,
      setTimer(() => {
        retries.delete(task.id)
        if (!started || !tasks.has(task.id)) return
        void fireTask(task.id, 'retry', {
          attempt,
          maxAttempts: MAX_TASK_RETRIES,
          ...(run.scheduledFor ? { scheduledFor: run.scheduledFor } : {}),
        })
      }, delay),
    )
    log('info', 'tasks: retry scheduled', { id: task.id, attempt, delay })
  }

  const execute = async (task: StoredTask, run: TaskRun, controller: AbortController): Promise<void> => {
    let watch: RunWatch | undefined
    try {
      if (task.action === 'remind') {
        if (!deps.remind) throw new Error('reminders are not available in this host')
        await deps.remind(view(task))
        run.status = 'done'
        run.summary = clip(task.prompt, SUMMARY_MAX_CHARS)
      } else {
        await runAgent(task, run, controller.signal, (w) => (watch = w))
      }
    } catch (e) {
      const err = e as Error & { text?: string }
      run.status = stopping ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed'
      if (run.status === 'interrupted') run.reason = 'app_quit'
      else if (run.status === 'failed') run.reason = reasonForRunError(watch?.lastError) ?? run.reason
      run.error = watch?.lastError?.message ?? err?.message ?? String(e)
      if (err?.text) run.summary = clip(err.text, SUMMARY_MAX_CHARS)
      log(run.status === 'failed' ? 'warn' : 'info', `tasks: run ${run.status}`, { id: task.id, reason: run.reason })
    } finally {
      watch?.stop()
      run.finishedAt = now()
      run.durationMs = run.finishedAt - run.startedAt
      active.delete(task.id)
      if (
        run.status === 'failed' &&
        started &&
        tasks.has(task.id) &&
        shouldRetryRun(run.reason, watch?.sideEffects ?? 0, run.attempt ?? 0)
      )
        scheduleRetry(task, run, watch?.lastError?.retryAfterMs)
      const stored = tasks.get(task.id)
      if (stored) {
        stored.lastRunAt = run.startedAt
        stored.lastRunStatus = run.status
        void persistTasks()
      }
      recordRunUpdate({ ...run })
      await files.appendRun(run)
      if (runs.length > RUNS_KEEP * 2) {
        runs = runs.slice(-RUNS_KEEP)
        await files.compactRuns(runs)
      }
      deps.onChanged?.({ reason: 'scheduled', id: task.id })
    }
  }

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
      // A finished one-shot (switched off) may still be renamed or edited without moving its time.
      if (data.enabled || data.schedule.kind !== 'once') {
        const preview = previewSchedule(data.schedule, at, 1)
        if (!preview.ok) throw new Error(`invalid schedule: ${preview.error}`)
      }
      const keep = existing && sameSchedule(existing.schedule, data.schedule)
      const { lastSlotAt: _slot, ...base } = existing ?? { createdAt: at, lastSlotAt: undefined }
      const stored: StoredTask = {
        ...base,
        ...data,
        id,
        updatedAt: at,
        scheduleSince: keep ? existing.scheduleSince : at,
        ...(keep && existing.lastSlotAt ? { lastSlotAt: existing.lastSlotAt } : {}),
      }
      tasks.set(id, stored)
      arm(stored, at)
      ticker.replan()
      await persistTasks()
      deps.onChanged?.({ reason: 'saved', id })
      return view(stored)
    },

    async remove(id) {
      const task = tasks.get(id)
      if (!task) return
      this.cancel(id)
      cancelRetry(id)
      due.delete(id)
      tasks.delete(id)
      ticker.replan()
      await persistTasks()
      deps.onChanged?.({ reason: 'deleted', id })
    },

    async setEnabled(id, enabled) {
      const task = require(id)
      if (task.enabled !== enabled) {
        task.enabled = enabled
        task.updatedAt = now()
        // Slots while paused are not "missed": counting starts again from now.
        if (enabled) task.lastSlotAt = task.updatedAt
        else cancelRetry(id)
        arm(task)
        ticker.replan()
        await persistTasks()
        deps.onChanged?.({ reason: 'toggled', id })
      }
      return view(task)
    },

    runNow: (id) => fireTask(id, 'manual'),

    cancel(id) {
      cancelRetry(id)
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
      stopping = false
      aliveAt = ticker.previousAliveAt
      for (const task of tasks.values()) arm(task, task.lastSlotAt ?? task.lastRunAt ?? task.scheduleSince)
      log('info', 'tasks: scheduler started', { tasks: tasks.size, armed: due.size })
      ticker.start()
    },

    stop() {
      started = false
      stopping = true
      ticker.stop()
      due.clear()
      for (const id of [...retries.keys()]) cancelRetry(id)
      for (const { controller } of active.values()) controller.abort()
    },

    flush: () => files.flush(),
  }
}
