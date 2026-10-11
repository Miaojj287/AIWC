import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  asThreadId,
  type Event,
  type ScheduledTaskDraft,
  type TaskRun,
  type ToolArtifact,
  type UserInput,
} from '@aiwc/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catchUpDecision, missedReason, reasonForRunError, shouldRetryRun, taskRetryDelayMs } from './taskRecovery'
import { createTaskScheduler, type TaskSchedulerDeps } from './taskScheduler'
import { missedSlots, nextFireAt } from './taskTiming'

const HOUR = 60 * 60_000
const T0 = new Date(2030, 0, 15, 8, 0).getTime()

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-task-recovery-'))
})
afterEach(async () => {
  // Stopped schedulers may still land a queued heartbeat / run write while the folder is being removed: retry.
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (e) {
      if (attempt >= 50) throw e
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
})

describe('recovery policy', () => {
  it('tells app-closed from asleep by the heartbeat and the wake gap', () => {
    expect(missedReason(T0 + HOUR, T0, undefined)).toBe('app_not_running')
    expect(missedReason(T0 + HOUR, undefined, undefined)).toBe('app_not_running')
    expect(missedReason(T0 + HOUR, T0 + 2 * HOUR, undefined)).toBe('machine_asleep')
    expect(missedReason(T0 + HOUR, T0 + 2 * HOUR, T0 + 30 * 60_000)).toBe('machine_asleep')
  })

  it('runs a missed slot late only within the window and when the task wants it', () => {
    const missed = { count: 2, latest: T0 }
    expect(catchUpDecision({ catchUp: 'once' }, missed, T0 + HOUR)).toBe('run')
    expect(catchUpDecision({ catchUp: 'once' }, missed, T0 + 13 * HOUR)).toBe('record')
    expect(catchUpDecision({ catchUp: 'skip' }, missed, T0 + HOUR)).toBe('record')
  })

  it('classifies failures by structured code and status, and retries only transient ones without side effects', () => {
    expect(reasonForRunError({ code: 'rate_limit', message: '', status: 429 })).toBe('rate_limited')
    expect(reasonForRunError({ code: 'network', message: '', status: 503 })).toBe('network')
    expect(reasonForRunError({ code: 'stream_stalled', message: '' })).toBe('network')
    expect(reasonForRunError({ code: 'auth', message: '' })).toBe('model_unavailable')
    expect(reasonForRunError({ code: 'invalid_request', message: '', status: 404 })).toBe('model_unavailable')
    expect(reasonForRunError({ code: 'invalid_request', message: '', status: 400 })).toBeUndefined()
    expect(reasonForRunError({ code: 'empty_response', message: '' })).toBe('empty_result')
    expect(shouldRetryRun('rate_limited', 0, 0)).toBe(true)
    expect(shouldRetryRun('rate_limited', 1, 0)).toBe(false)
    expect(shouldRetryRun('network', 0, 2)).toBe(false)
    expect(shouldRetryRun('model_unavailable', 0, 0)).toBe(false)
    expect(taskRetryDelayMs(1)).toBe(60_000)
    expect(taskRetryDelayMs(2)).toBe(240_000)
    expect(taskRetryDelayMs(1, 300_000)).toBe(300_000)
  })

  it('counts missed slots and one-shot times', () => {
    const daily = { kind: 'daily', time: '09:00' } as const
    expect(missedSlots(daily, T0, T0, T0 + 50 * HOUR)).toEqual({
      count: 3,
      latest: new Date(2030, 0, 17, 9, 0).getTime(),
    })
    expect(missedSlots({ kind: 'interval', everyMinutes: 60 }, T0, T0, T0 + 3.5 * HOUR)).toEqual({
      count: 3,
      latest: T0 + 3 * HOUR,
    })
    expect(nextFireAt({ kind: 'once', at: T0 + HOUR }, T0, T0)).toBe(T0 + HOUR)
    expect(nextFireAt({ kind: 'once', at: T0 + HOUR }, T0, T0 + 2 * HOUR)).toBeUndefined()
  })
})

/* ---------------------------------------------------------------- scheduler integration */

interface Harness {
  clock: { now: number }
  runs: TaskRun[]
  /** Fire the ticker's (or a retry's) pending timers whose time has come. */
  advance(ms: number): void
  kernel: FakeKernel
  deps: TaskSchedulerDeps
}

interface FakeKernel {
  calls: UserInput[]
  listeners: Set<(e: Event) => void>
  settle?: { resolve(text: string): void; reject(err: Error): void }
  ensureThread: TaskSchedulerDeps['kernel']['ensureThread']
  runOnce: TaskSchedulerDeps['kernel']['runOnce']
  events: TaskSchedulerDeps['kernel']['events']
  emit(e: Event): void
}

function fakeKernel(): FakeKernel {
  const k: FakeKernel = {
    calls: [],
    listeners: new Set(),
    ensureThread: async () => asThreadId('thr-1'),
    runOnce: (_id, input) =>
      new Promise<{ text: string; artifacts: ToolArtifact[] }>((resolve, reject) => {
        k.calls.push(input)
        k.settle = { resolve: (text) => resolve({ text, artifacts: [] }), reject }
      }),
    events: {
      on(listener) {
        k.listeners.add(listener)
        return () => k.listeners.delete(listener)
      },
    },
    emit: (e) => k.listeners.forEach((l) => l(e)),
  }
  return k
}

function harness(start: number, extra: Partial<TaskSchedulerDeps> = {}): Harness {
  const clock = { now: start }
  const timers = new Map<number, { at: number; fn: () => void }>()
  let seq = 0
  const runs: TaskRun[] = []
  const kernel = fakeKernel()
  const deps: TaskSchedulerDeps = {
    dir,
    kernel,
    input: (task) => ({ content: [{ type: 'text', text: task.prompt }], mentions: [] }),
    threadTitle: (task) => task.name,
    onRun: (run) => runs.push({ ...run }),
    now: () => clock.now,
    setTimer: (fn, ms) => {
      const id = ++seq
      timers.set(id, { at: clock.now + ms, fn })
      return () => timers.delete(id)
    },
    ...extra,
  }
  return {
    clock,
    runs,
    kernel,
    deps,
    advance(ms) {
      clock.now += ms
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > clock.now || !timers.has(id)) continue
        timers.delete(id)
        timer.fn()
      }
    },
  }
}

const draft = (patch: Partial<ScheduledTaskDraft> = {}): ScheduledTaskDraft => ({
  name: 'brief',
  prompt: 'write the brief',
  schedule: { kind: 'daily', time: '09:00' },
  ...patch,
})

const waitFor = async (pred: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5))
  if (!pred()) throw new Error('condition not met')
}

const last = (runs: TaskRun[]): TaskRun | undefined => runs[runs.length - 1]

describe('scheduler recovery', () => {
  it('runs a slot missed while the app was closed once, late, and says why', async () => {
    const first = harness(T0)
    const a = createTaskScheduler(first.deps)
    a.start()
    await a.save(draft())
    await waitFor(() => existsSync(join(dir, 'heartbeat.json')))
    a.stop()

    const later = harness(T0 + 3 * HOUR)
    const b = createTaskScheduler(later.deps)
    b.start()
    await waitFor(() => later.kernel.calls.length === 1)
    expect(later.runs[0]).toMatchObject({
      trigger: 'catch_up',
      status: 'running',
      reason: 'app_not_running',
      missedCount: 1,
      scheduledFor: new Date(2030, 0, 15, 9, 0).getTime(),
    })
    later.kernel.settle!.resolve('done')
    await waitFor(() => last(later.runs)?.status === 'done')
    b.stop()
  })

  it('only records the missed slot when catch-up is off or the slot is too old', async () => {
    const first = harness(T0)
    const a = createTaskScheduler(first.deps)
    a.start()
    await a.save(draft({ catchUp: 'skip' }))
    a.stop()

    const later = harness(T0 + 3 * HOUR)
    const b = createTaskScheduler(later.deps)
    b.start()
    expect(later.kernel.calls).toHaveLength(0)
    expect(later.runs[0]).toMatchObject({ status: 'missed', missedCount: 1 })
    expect(b.list()[0]?.lastRunStatus).toBe('missed')
    b.stop()
  })

  it('marks a slot slept through at runtime as machine_asleep', async () => {
    const h = harness(T0)
    const s = createTaskScheduler(h.deps)
    s.start()
    await s.save(draft({ catchUp: 'skip' }))
    h.advance(30_000)
    // the machine sleeps from 08:00:30 to 10:00
    h.advance(2 * HOUR - 30_000)
    expect(last(h.runs)).toMatchObject({ status: 'missed', reason: 'machine_asleep' })
    s.stop()
  })

  it('loads a run the app quit during as interrupted', () => {
    writeFileSync(
      join(dir, 'runs.jsonl'),
      `${JSON.stringify({ id: 'r1', taskId: 't1', trigger: 'schedule', status: 'running', startedAt: T0, denied: [], toolCalls: 0 })}\n`,
    )
    const s = createTaskScheduler(harness(T0).deps)
    expect(s.runs()[0]).toMatchObject({ id: 'r1', status: 'interrupted', reason: 'app_quit' })
  })

  it('retries a rate-limited run after the requested wait, but not one that already changed something', async () => {
    const h = harness(T0)
    const s = createTaskScheduler(h.deps)
    s.start()
    const task = await s.save(draft())
    await s.runNow(task.id)
    await waitFor(() => h.kernel.calls.length === 1)
    h.kernel.emit({
      type: 'error',
      threadId: asThreadId('thr-1'),
      error: { code: 'rate_limit', message: '429', status: 429, retryable: true, retryAfterMs: 120_000 },
      actions: [],
    })
    h.kernel.settle!.reject(new Error('turn aborted: error'))
    await waitFor(() => last(h.runs)?.status === 'failed')
    expect(last(h.runs)).toMatchObject({ reason: 'rate_limited', retryAt: T0 + 120_000, maxAttempts: 2 })

    h.advance(120_000)
    await waitFor(() => h.kernel.calls.length === 2)
    expect(last(h.runs)).toMatchObject({ trigger: 'retry', attempt: 1, status: 'running' })

    h.kernel.emit({
      type: 'tool.call',
      threadId: asThreadId('thr-1'),
      turnId: 'trn' as never,
      stepId: 'stp' as never,
      callId: 'c1' as never,
      toolName: 'shell',
      summary: 'shell',
      input: {},
      status: 'done',
      risk: 'write',
      startedAt: T0,
    })
    h.kernel.emit({
      type: 'error',
      threadId: asThreadId('thr-1'),
      error: { code: 'network', message: 'reset', retryable: true },
      actions: [],
    })
    h.kernel.settle!.reject(new Error('turn aborted: error'))
    await waitFor(() => last(h.runs)?.status === 'failed')
    expect(last(h.runs)?.retryAt).toBeUndefined()
    s.stop()
  })

  it('records an empty answer as a failure', async () => {
    const h = harness(T0)
    const s = createTaskScheduler(h.deps)
    const task = await s.save(draft())
    await s.runNow(task.id)
    await waitFor(() => h.kernel.calls.length === 1)
    h.kernel.settle!.resolve('   ')
    await waitFor(() => last(h.runs)?.status === 'failed')
    expect(last(h.runs)?.reason).toBe('empty_result')
  })

  it('fires a one-shot reminder without a model and switches the task off', async () => {
    const reminded: string[] = []
    const h = harness(T0, {
      remind: async (task) => {
        reminded.push(task.prompt)
      },
    })
    const s = createTaskScheduler(h.deps)
    s.start()
    const task = await s.save(
      draft({ action: 'remind', prompt: 'stand up', schedule: { kind: 'once', at: T0 + 30 * 60_000 } }),
    )
    expect(task.nextRunAt).toBe(T0 + 30 * 60_000)
    h.advance(30_000)
    h.advance(30 * 60_000)
    await waitFor(() => last(h.runs)?.status === 'done')
    expect(reminded).toEqual(['stand up'])
    expect(h.kernel.calls).toHaveLength(0)
    expect(s.get(task.id)?.task).toMatchObject({ enabled: false })
    expect(s.get(task.id)?.task.nextRunAt).toBeUndefined()
    await expect(s.save(draft({ schedule: { kind: 'once', at: T0 } }))).rejects.toThrow(/invalid schedule/)
    s.stop()
  })
})
