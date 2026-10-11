import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { asCallId, asThreadId, asTurnId, defineTool, newStepId, type Event } from '@aiwc/protocol'
import type { ToolDispatchContext } from '../ports'
import { createApprovalGate } from './approval'
import { createHookRunner } from './hooks'
import { createToolRegistry } from './registry'
import { createToolRouterFactory } from './router'

afterEach(() => vi.useRealTimers())

function setup(opts: { onApprovalWait?: () => () => void } = {}) {
  const registry = createToolRegistry()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  registry.register(
    defineTool<{ id: string }>({
      name: 'rename_task',
      description: 'r',
      inputSchema: z.object({ id: z.string() }),
      profiles: ['desktop-chat'],
      risk: 'write',
      parallelSafe: false,
      summarize: (i) => `改 ${i.id}`,
      // what the input does not carry (the task's name) travels with the call as data
      describe: (i) => ({ code: 'task_update', params: { name: `任务 ${i.id}` } }),
      execute: async () => ({ content: 'ok' }),
    }),
  )
  registry.register(
    defineTool<Record<string, never>>({
      name: 'bad_describer',
      description: 'b',
      inputSchema: z.object({}),
      profiles: ['desktop-chat'],
      risk: 'read',
      parallelSafe: true,
      describe: () => {
        throw new Error('no')
      },
      execute: async () => ({ content: 'ok' }),
    }),
  )
  registry.register(
    defineTool<Record<string, never>>({
      name: 'waits_for_user',
      description: 'w',
      inputSchema: z.object({}),
      profiles: ['desktop-chat'],
      risk: 'read',
      parallelSafe: true,
      timeoutMs: 20,
      execute: async (_i, ctx) => {
        const resume = ctx.pauseTimeouts?.()
        await gate
        resume?.()
        return { content: 'answered' }
      },
    }),
  )
  const router = createToolRouterFactory({
    registry,
    approvals: createApprovalGate(),
    hooks: createHookRunner(),
    services: {},
  }).build({ profile: 'desktop-chat', depth: 0, permissionMode: () => 'bypass' })
  const events: Event[] = []
  const ctx: ToolDispatchContext = {
    threadId: asThreadId('thr_1'),
    turnId: asTurnId('trn_1'),
    stepId: newStepId(),
    channel: 'desktop',
    profile: 'desktop-chat',
    depth: 0,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    onApprovalWait: opts.onApprovalWait,
  }
  return { router, events, ctx, release: () => release() }
}

describe('tool summaries as data', () => {
  it('records what the tool describes with every tool.call event', async () => {
    const { router, events, ctx } = setup()
    expect(router.describe?.('rename_task', { id: '7' })).toEqual({ code: 'task_update', params: { name: '任务 7' } })
    await router.dispatch({ callId: asCallId('cal_1'), toolName: 'rename_task', input: { id: '7' } }, ctx)
    const calls = events.filter((e) => e.type === 'tool.call')
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.every((e) => e.type === 'tool.call' && e.display?.params?.name === '任务 7')).toBe(true)
  })

  it('leaves the display out when the describer cannot read the input', async () => {
    const { router, events, ctx } = setup()
    expect(router.describe?.('bad_describer', {})).toBeUndefined()
    await router.dispatch({ callId: asCallId('cal_1'), toolName: 'bad_describer', input: {} }, ctx)
    expect(events.some((e) => e.type === 'tool.call' && e.display !== undefined)).toBe(false)
  })
})

describe('pauseTimeouts', () => {
  it('holds the tool timeout and the turn budget while the call waits for the user', async () => {
    vi.useFakeTimers()
    const waits: string[] = []
    const { router, ctx, release } = setup({
      onApprovalWait: () => {
        waits.push('start')
        return () => waits.push('end')
      },
    })
    const outcome = router.dispatch({ callId: asCallId('cal_1'), toolName: 'waits_for_user', input: {} }, ctx)
    await vi.advanceTimersByTimeAsync(1_000)
    release()
    await expect(outcome).resolves.toMatchObject({ status: 'done' })
    expect(waits).toEqual(['start', 'end'])
  })
})
