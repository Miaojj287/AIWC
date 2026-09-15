import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asThreadId, type Event, type TaskRun, type ThreadId, type ToolArtifact, type UserInput } from '@aiwc/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cronPatternFor, createTaskScheduler, nextIntervalAt, previewSchedule } from './taskScheduler'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-tasks-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('schedules', () => {
  it('maps calendar schedules to 6-field cron patterns', () => {
    expect(cronPatternFor({ kind: 'daily', time: '08:30' })).toBe('0 30 8 * * *')
    expect(cronPatternFor({ kind: 'weekly', days: [5, 1, 1], time: '09:00' })).toBe('0 0 9 * * 1,5')
    expect(cronPatternFor({ kind: 'cron', expression: '0 */15 * * * *' })).toBe('0 */15 * * * *')
    expect(cronPatternFor({ kind: 'interval', everyMinutes: 300 })).toBeUndefined()
  })

  it('counts intervals from the schedule anchor, never from "now"', () => {
    const since = Date.UTC(2026, 8, 13, 10, 0)
    const hour = 60 * 60_000
    expect(nextIntervalAt(300, since, since)).toBe(since + 5 * hour)
    expect(nextIntervalAt(300, since, since + 5 * hour)).toBe(since + 10 * hour)
    expect(nextIntervalAt(300, since, since + 7 * hour)).toBe(since + 10 * hour)
    expect(nextIntervalAt(300, since, since - hour)).toBe(since)
  })

  it('previews the next fire times and rejects bad cron expressions', () => {
    const now = Date.UTC(2026, 8, 13, 10, 0)
    const daily = previewSchedule({ kind: 'daily', time: '08:30' }, now)
    expect(daily.ok).toBe(true)
    if (daily.ok) {
      expect(daily.next).toHaveLength(3)
      expect(daily.next[1]! - daily.next[0]!).toBe(24 * 60 * 60_000)
    }
    const every = previewSchedule({ kind: 'interval', everyMinutes: 5 }, now)
    expect(every).toEqual({ ok: true, next: [now + 5 * 60_000, now + 10 * 60_000, now + 15 * 60_000] })
    expect(previewSchedule({ kind: 'cron', expression: 'not a cron' }, now).ok).toBe(false)
  })
})

interface FakeKernel {
  listeners: Set<(e: Event) => void>
  emit(e: Event): void
  inputs: UserInput[]
  settings: unknown[]
  resolve?: (text: string) => void
  reject?: (err: Error) => void
  ensureThread: (origin: unknown, settings?: unknown) => Promise<ThreadId>
  runOnce: (
    threadId: string,
    input: UserInput,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ text: string; artifacts: ToolArtifact[] }>
  events: { on(listener: (e: Event) => void): () => void }
}

function fakeKernel(): FakeKernel {
  const k: FakeKernel = {
    listeners: new Set(),
    emit: (e) => k.listeners.forEach((l) => l(e)),
    inputs: [],
    settings: [],
    ensureThread: async (_origin, settings) => {
      k.settings.push(settings)
      return asThreadId('thr-1')
    },
    runOnce: (_threadId, input, opts) =>
      new Promise((resolve, reject) => {
        k.inputs.push(input)
        k.resolve = (text) => resolve({ text, artifacts: [] })
        k.reject = reject
        opts?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('turn aborted: interrupted'), { reason: 'interrupted', text: 'partial' })),
        )
      }),
    events: {
      on(listener) {
        k.listeners.add(listener)
        return () => k.listeners.delete(listener)
      },
    },
  }
  return k
}

const toolCall = (status: 'running' | 'done' | 'denied', toolName: string, allowKey?: string): Event =>
  ({
    type: 'tool.call',
    threadId: asThreadId('thr-1'),
    turnId: 'turn-1',
    stepId: 'step-1',
    callId: `call-${Math.random()}`,
    toolName,
    summary: `${toolName} …`,
    input: {},
    status,
    risk: 'write',
    ...(allowKey ? { allowKey } : {}),
    startedAt: Date.now(),
  }) as Event

const latest = (list: TaskRun[], id: string): TaskRun | undefined => [...list].reverse().find((r) => r.id === id)

const waitFor = async (pred: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5))
  if (!pred()) throw new Error('condition not met')
}

describe('createTaskScheduler', () => {
  it('runs a task in a cron thread in its permission mode and records the outcome', async () => {
    const kernel = fakeKernel()
    const runs: TaskRun[] = []
    const scheduler = createTaskScheduler({
      dir,
      kernel,
      input: (task) => ({ content: [{ type: 'text', text: `WRAPPED ${task.prompt}` }], mentions: [] }),
      threadTitle: (task) => `T · ${task.name}`,
      onRun: (run) => runs.push(run),
    })
    scheduler.start()
    const task = await scheduler.save({
      name: 'push',
      prompt: 'push it',
      schedule: { kind: 'daily', time: '08:30' },
      enabled: true,
      permissionMode: 'autopilot',
    })
    expect(task.nextRunAt).toBeGreaterThan(Date.now())

    const run = await scheduler.runNow(task.id)
    expect(run.status).toBe('running')
    expect(scheduler.list()[0]?.running).toBe(true)
    // A second 立即执行 while running returns the same run instead of starting another.
    expect((await scheduler.runNow(task.id)).id).toBe(run.id)

    await waitFor(() => kernel.inputs.length === 1)
    expect(kernel.settings[0]).toMatchObject({
      profile: 'cron',
      permissionMode: 'autopilot',
      allowAlways: [],
      title: 'T · push',
    })
    expect(kernel.inputs[0]?.content[0]).toEqual({ type: 'text', text: 'WRAPPED push it' })

    kernel.emit(toolCall('running', 'search_messages'))
    kernel.emit(toolCall('done', 'search_messages'))
    kernel.emit(toolCall('running', 'shell', 'shell:lark-cli base'))
    kernel.emit(toolCall('denied', 'shell', 'shell:lark-cli base'))
    kernel.emit(toolCall('denied', 'shell', 'shell:lark-cli base'))
    kernel.resolve!('  done, 1 step skipped  ')
    await waitFor(() => runs.some((r) => r.id === run.id && r.status === 'done'))

    const finished = latest(runs, run.id)!
    expect(finished).toMatchObject({
      status: 'done',
      threadId: asThreadId('thr-1'),
      summary: 'done, 1 step skipped',
      toolCalls: 2,
      denied: [{ tool: 'shell', key: 'shell:lark-cli base', risk: 'write', summary: 'shell …' }],
    })
    expect(finished.durationMs).toBeGreaterThanOrEqual(0)
    const stored = scheduler.get(task.id)!
    expect(stored.task.lastRunStatus).toBe('done')
    expect(stored.task.running).toBeUndefined()
    expect(stored.runs.map((r) => r.id)).toEqual([run.id])

    // Persistence: a fresh scheduler over the same directory sees the task and its history.
    await waitFor(() => readFileSync(join(dir, 'runs.jsonl'), 'utf8').includes(run.id))
    scheduler.stop()
    const again = createTaskScheduler({
      dir,
      kernel,
      input: () => ({ content: [], mentions: [] }),
      threadTitle: () => '',
    })
    expect(again.list()).toHaveLength(1)
    expect(again.list()[0]).toMatchObject({ id: task.id, name: 'push', permissionMode: 'autopilot' })
    expect(again.runs({ id: task.id })[0]).toMatchObject({ id: run.id, status: 'done' })
  })

  it('cancel aborts the run and keeps the partial text; a failed run keeps the error', async () => {
    const kernel = fakeKernel()
    const runs: TaskRun[] = []
    const scheduler = createTaskScheduler({
      dir,
      kernel,
      input: () => ({ content: [], mentions: [] }),
      threadTitle: () => '',
      onRun: (run) => runs.push(run),
    })
    const task = await scheduler.save({
      name: 'x',
      prompt: 'p',
      schedule: { kind: 'interval', everyMinutes: 60 },
      enabled: false,
      permissionMode: 'bypass',
    })
    expect(task.nextRunAt).toBeUndefined()

    const run = await scheduler.runNow(task.id)
    await waitFor(() => kernel.inputs.length === 1)
    expect(scheduler.cancel(task.id)).toBe(true)
    await waitFor(() => runs.some((r) => r.id === run.id && r.status === 'cancelled'))
    expect(latest(runs, run.id)).toMatchObject({ status: 'cancelled', summary: 'partial' })
    expect(scheduler.cancel(task.id)).toBe(false)

    const second = await scheduler.runNow(task.id)
    await waitFor(() => kernel.inputs.length === 2)
    kernel.reject!(new Error('model down'))
    await waitFor(() => runs.some((r) => r.id === second.id && r.status === 'failed'))
    expect(latest(runs, second.id)).toMatchObject({ status: 'failed', error: 'model down' })
    expect(scheduler.get(task.id)?.task.lastRunStatus).toBe('failed')
  })

  it('validates input and refuses schedules that never fire', async () => {
    const scheduler = createTaskScheduler({
      dir,
      kernel: fakeKernel(),
      input: () => ({ content: [], mentions: [] }),
      threadTitle: () => '',
    })
    await expect(
      scheduler.save({
        name: '',
        prompt: 'p',
        schedule: { kind: 'daily', time: '08:30' },
        enabled: true,
        permissionMode: 'bypass',
      }),
    ).rejects.toThrow()
    await expect(
      scheduler.save({
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'cron', expression: 'nope nope nope' },
        enabled: true,
        permissionMode: 'bypass',
      }),
    ).rejects.toThrow(/invalid schedule/)
    await expect(scheduler.setEnabled('missing', true)).rejects.toThrow(/unknown task/)
    expect(await scheduler.runs()).toEqual([])
  })

  it('keeps the interval anchor across unrelated edits and resets it when the schedule changes', async () => {
    // croner compares against the wall clock, so the anchor must be in the real future.
    let clock = Math.ceil(Date.now() / 60_000) * 60_000 + 60_000
    const scheduler = createTaskScheduler({
      dir,
      kernel: fakeKernel(),
      input: () => ({ content: [], mentions: [] }),
      threadTitle: () => '',
      now: () => clock,
    })
    scheduler.start()
    const task = await scheduler.save({
      name: 'a',
      prompt: 'p',
      schedule: { kind: 'interval', everyMinutes: 300 },
      enabled: true,
      permissionMode: 'bypass',
    })
    expect(task.nextRunAt).toBe(clock + 5 * 60 * 60_000)
    clock += 60 * 60_000
    const renamed = await scheduler.save({ ...task, name: 'b' })
    expect(renamed.nextRunAt).toBe(task.nextRunAt)
    const rescheduled = await scheduler.save({ ...task, schedule: { kind: 'interval', everyMinutes: 30 } })
    expect(rescheduled.nextRunAt).toBe(clock + 30 * 60_000)
    scheduler.stop()
  })
})
