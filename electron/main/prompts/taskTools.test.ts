import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asCallId, asThreadId, type StepId, type ToolContext, type TurnId } from '@aiwc/protocol'
import { createApprovalGate } from '@aiwc/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskScheduler } from '../services/taskScheduler'
import { scheduleFromInput, taskTools } from './taskTools'

const NOW = new Date(2030, 0, 15, 8, 0).getTime()
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-task-tools-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const ctx: ToolContext = {
  threadId: asThreadId('thr_src'),
  turnId: 'trn' as TurnId,
  stepId: 'stp' as StepId,
  callId: asCallId('c'),
  channel: 'desktop',
  profile: 'desktop-chat',
  signal: new AbortController().signal,
  services: {},
  progress: () => {},
  depth: 0,
}

describe('task tools', () => {
  it('resolves relative and local one-shot times against the real clock', () => {
    expect(scheduleFromInput({ type: 'once', in_minutes: 30 }, NOW)).toEqual({ kind: 'once', at: NOW + 30 * 60_000 })
    expect(scheduleFromInput({ type: 'once', at: '2030-01-15T09:15' }, NOW)).toEqual({
      kind: 'once',
      at: new Date(2030, 0, 15, 9, 15).getTime(),
    })
    expect(() => scheduleFromInput({ type: 'once', at: '2030-01-14T09:15' }, NOW)).toThrow()
    expect(() => scheduleFromInput({ type: 'once' }, NOW)).toThrow()
    expect(scheduleFromInput({ type: 'weekly', days: [1, 3], time: '09:00' }, NOW)).toEqual({
      kind: 'weekly',
      days: [1, 3],
      time: '09:00',
    })
  })

  it('creates a reminder bound to the conversation, lists, pauses and deletes it', async () => {
    const scheduler = createTaskScheduler({
      dir,
      kernel: {
        ensureThread: async () => asThreadId('x'),
        runOnce: async () => ({ text: '', artifacts: [] }),
        events: { on: () => () => {} },
      },
      input: () => ({ content: [], mentions: [] }),
      threadTitle: () => '',
      now: () => NOW,
      setTimer: () => () => {},
    })
    scheduler.start()
    const [create, list, update, remove] = taskTools(scheduler, () => NOW)
    // Autopilot lets a task send unattended: it is confirmed like a send, not a plain write.
    expect(create!.classify!({ permission_mode: 'autopilot' })).toEqual({ risk: 'send', canAllowAlways: false })
    expect(create!.classify!({})).toEqual({ risk: 'write' })
    expect(remove!.risk).toBe('destructive')

    const input = create!.inputSchema.parse({
      name: '开会',
      prompt: '该去开会了',
      action: 'remind',
      schedule: { type: 'once', in_minutes: 30 },
    })
    const created = (await create!.execute(input, ctx)).content as { created: { id: string; next_run_at: string } }
    const stored = scheduler.get(created.created.id)!.task
    expect(stored).toMatchObject({ action: 'remind', sourceThreadId: 'thr_src', nextRunAt: NOW + 30 * 60_000 })

    const listed = (await list!.execute({}, ctx)).content as { tasks: Array<{ id: string }> }
    expect(listed.tasks.map((t) => t.id)).toEqual([stored.id])

    await update!.execute(update!.inputSchema.parse({ id: stored.id, enabled: false }), ctx)
    expect(scheduler.get(stored.id)?.task.enabled).toBe(false)
    await remove!.execute({ id: stored.id }, ctx)
    expect(scheduler.list()).toEqual([])
    expect((await remove!.execute({ id: stored.id }, ctx)).isError).toBe(true)
    scheduler.stop()
  })

  it('judges task_update on the task it leaves behind, so re-arming an Autopilot task is a send', async () => {
    const scheduler = createTaskScheduler({
      dir,
      kernel: {
        ensureThread: async () => asThreadId('x'),
        runOnce: async () => ({ text: '', artifacts: [] }),
        events: { on: () => () => {} },
      },
      input: () => ({ content: [], mentions: [] }),
      threadTitle: () => '',
      now: () => NOW,
      setTimer: () => () => {},
    })
    scheduler.start()
    const update = taskTools(scheduler, () => NOW)[2]!
    const auto = await scheduler.save({
      name: '群发',
      prompt: '给大家发早安',
      schedule: { kind: 'daily', time: '09:00' },
      permissionMode: 'autopilot',
    })
    const gate = createApprovalGate()
    const verdict = (input: unknown, mode: 'ask' | 'bypass', allowAlways: string[] = []): string => {
      const policy = update.classify!(update.inputSchema.parse(input))
      return gate.decide({
        toolName: update.name,
        risk: policy.risk,
        mode,
        channel: 'desktop',
        allowAlways,
        ...(policy.allowKey ? { allowKey: policy.allowKey } : {}),
      })
    }
    // only the prompt changes, but the result still sends unattended: confirmed even in Bypass or with a grant
    expect(update.classify!(update.inputSchema.parse({ id: auto.id, prompt: '改成发晚安' }))).toEqual({
      risk: 'send',
      canAllowAlways: false,
    })
    expect(verdict({ id: auto.id, prompt: '改成发晚安' }, 'bypass')).toBe('ask')
    expect(verdict({ id: auto.id, schedule: { type: 'daily', time: '10:00' } }, 'ask', ['task_update'])).toBe('ask')
    // pausing it, or lowering the mode, leaves nothing that sends: a plain write
    expect(verdict({ id: auto.id, enabled: false }, 'bypass')).toBe('approved')
    expect(verdict({ id: auto.id, permission_mode: 'bypass' }, 'bypass')).toBe('approved')
    // resuming a paused Autopilot task re-arms it
    await scheduler.setEnabled(auto.id, false)
    expect(verdict({ id: auto.id, name: '群发 2' }, 'bypass')).toBe('approved')
    expect(verdict({ id: auto.id, enabled: true }, 'bypass')).toBe('ask')
    scheduler.stop()
  })
})
