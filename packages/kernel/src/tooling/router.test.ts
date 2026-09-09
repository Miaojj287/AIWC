import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { asCallId, asThreadId, asTurnId, defineTool, newStepId, type ChannelKind, type Event, type PermissionMode, type ToolRisk } from '@aiwc/protocol'
import type { ToolDispatchContext } from '../ports'
import { createApprovalGate } from './approval'
import { createHookRunner } from './hooks'
import { createToolRegistry } from './registry'
import { createToolRouterFactory, USER_DENIED_MESSAGE, POLICY_DENIED_MESSAGE } from './router'
import { TRUNCATION_MARKER } from './schema'

const EchoInput = z.object({ text: z.string(), n: z.number().int().optional() })

function harness(opts?: { mode?: PermissionMode; allowAlways?: string[]; channel?: ChannelKind; policy?: { defaultTimeoutMs?: number; maxOutputChars?: number } }) {
  const registry = createToolRegistry()
  const approvals = createApprovalGate()
  const hooks = createHookRunner()
  const onAllowAlways = vi.fn()
  const services = { marker: 'svc' }
  registry.register(
    defineTool<z.infer<typeof EchoInput>>({
      name: 'echo',
      description: 'echo',
      inputSchema: EchoInput,
      profiles: ['desktop-chat'],
      risk: 'read',
      parallelSafe: true,
      summarize: (i) => `回显 ${i.text}`,
      execute: async (i) => ({ content: i.text.repeat(i.n ?? 1) }),
    }),
  )
  registry.register(
    defineTool<{ text: string }>({
      name: 'write_note',
      description: 'w',
      inputSchema: z.object({ text: z.string() }),
      profiles: ['desktop-chat'],
      risk: 'write',
      parallelSafe: false,
      execute: async (i) => ({ content: `wrote ${i.text}`, artifacts: [{ kind: 'markdown', title: 'note', content: i.text }] }),
    }),
  )
  registry.register(
    defineTool<{ text: string }>({
      name: 'nuke',
      description: 'd',
      inputSchema: z.object({ text: z.string() }),
      profiles: ['desktop-chat'],
      risk: 'destructive',
      parallelSafe: false,
      execute: async () => ({ content: 'gone' }),
    }),
  )
  registry.register(
    defineTool<{ ms: number }>({
      name: 'slow',
      description: 's',
      inputSchema: z.object({ ms: z.number() }),
      profiles: ['desktop-chat'],
      risk: 'read',
      parallelSafe: true,
      timeoutMs: 30,
      execute: (i, ctx) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve({ content: 'late' }), i.ms)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(t)
            reject(new Error('aborted'))
          })
        }),
    }),
  )
  registry.register(
    defineTool<Record<string, never>>({
      name: 'thrower',
      description: 't',
      inputSchema: z.object({}),
      profiles: ['desktop-chat'],
      risk: 'read',
      parallelSafe: true,
      execute: async () => { throw new Error('kaboom') },
    }),
  )
  registry.register(
    defineTool<Record<string, never>>({
      name: 'hidden_helper',
      description: 'h',
      inputSchema: z.object({}),
      profiles: ['desktop-chat'],
      risk: 'read',
      parallelSafe: true,
      exposure: 'hidden',
      execute: async (_i, ctx) => {
        ctx.progress('half', 0.5)
        return { content: { svc: (ctx.services as { marker: string }).marker, depth: ctx.depth } }
      },
    }),
  )
  const factory = createToolRouterFactory({ registry, approvals, hooks, services, policy: opts?.policy })
  const router = factory.build({
    profile: 'desktop-chat',
    depth: 0,
    permissionMode: () => opts?.mode ?? 'bypass',
    allowAlways: () => opts?.allowAlways ?? [],
    onAllowAlways,
  })
  const events: Event[] = []
  const ac = new AbortController()
  const ctx: ToolDispatchContext = {
    threadId: asThreadId('thr_1'),
    turnId: asTurnId('trn_1'),
    stepId: newStepId(),
    channel: opts?.channel ?? 'desktop',
    profile: 'desktop-chat',
    depth: 0,
    signal: ac.signal,
    emit: (e) => events.push(e),
  }
  const statuses = () => events.filter((e) => e.type === 'tool.call').map((e) => (e as Extract<Event, { type: 'tool.call' }>).status)
  return { router, approvals, hooks, events, statuses, ctx, ac, onAllowAlways }
}

const call = (toolName: string, input: unknown, id = 'cal_1') => ({ callId: asCallId(id), toolName, input })

describe('router specs', () => {
  it('specs are sorted, converted to JSON Schema and exclude hidden tools; has/risk/parallelSafe/summarize', () => {
    const { router } = harness()
    expect(router.specs.map((s) => s.name)).toEqual(['echo', 'nuke', 'slow', 'thrower', 'write_note'])
    expect(router.specs[0]?.inputJsonSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] })
    expect(router.has('hidden_helper')).toBe(true)
    expect(router.has('nope')).toBe(false)
    expect(router.risk('nuke')).toBe<ToolRisk>('destructive')
    expect(router.parallelSafe('echo')).toBe(true)
    expect(router.parallelSafe('write_note')).toBe(false)
    expect(router.summarize('echo', { text: 'hi' })).toBe('回显 hi')
    expect(router.summarize('write_note', { text: 'hi' })).toBe('write_note {"text":"hi"}')
  })
})

describe('dispatch funnel', () => {
  it('(a) unknown tool → error result, not thrown', async () => {
    const { router, ctx, statuses } = harness()
    const out = await router.dispatch(call('nope', {}), ctx)
    expect(out.isError).toBe(true)
    expect(out.status).toBe('error')
    expect(out.result.content).toContain('unsupported tool')
    expect(statuses()).toEqual(['pending', 'error'])
  })

  it('(b) invalid input → compact issue list', async () => {
    const { router, ctx } = harness()
    const out = await router.dispatch(call('echo', { text: 1, n: 'x' }), ctx)
    expect(out.status).toBe('error')
    expect(out.result.content).toMatch(/参数校验失败/)
    expect(out.result.content).toMatch(/text:/)
    expect(out.result.content).toMatch(/n:/)
  })

  it('happy path: bypass + read → done with events pending→running→done', async () => {
    const { router, ctx, statuses, events } = harness()
    const out = await router.dispatch(call('echo', { text: 'hi' }), ctx)
    expect(out).toMatchObject({ status: 'done', isError: false, result: { content: 'hi' } })
    expect(statuses()).toEqual(['pending', 'running', 'done'])
    const done = events.find((e) => e.type === 'tool.call' && e.status === 'done') as Extract<Event, { type: 'tool.call' }>
    expect(done.summary).toBe('回显 hi')
    expect(done.durationMs).toBeGreaterThanOrEqual(0)
    expect(done.output).toBe('hi')
  })

  it('(c) policy denied (cron channel may not write outside memory) → denied outcome', async () => {
    const { router, ctx } = harness({ mode: 'bypass', channel: 'cron' })
    const out = await router.dispatch(call('write_note', { text: 'x' }), ctx)
    expect(out.status).toBe('denied')
    expect(out.result.content).toBe(POLICY_DENIED_MESSAGE)
  })

  it('(c) ask mode never interrupts a read', async () => {
    const { router, ctx, events, statuses } = harness({ mode: 'ask' })
    const out = await router.dispatch(call('echo', { text: 'x' }), ctx)
    expect(out.status).toBe('done')
    expect(events.some((e) => e.type === 'approval.requested')).toBe(false)
    expect(statuses()).toEqual(['pending', 'running', 'done'])
  })

  it('(c) ask → awaiting_approval + approval.requested; deny → denied', async () => {
    const { router, ctx, approvals, events, statuses } = harness({ mode: 'ask' })
    const p = router.dispatch(call('write_note', { text: 'x' }), ctx)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'approval.requested')).toBe(true))
    const req = events.find((e) => e.type === 'approval.requested') as Extract<Event, { type: 'approval.requested' }>
    expect(req.canAllowAlways).toBe(true)
    expect(req.summary).toBe('write_note {"text":"x"}')
    expect(approvals.resolve(req.approvalId, 'deny')).toBe(true)
    const out = await p
    expect(out.status).toBe('denied')
    expect(out.isError).toBe(true)
    expect(out.result.content).toBe(USER_DENIED_MESSAGE)
    expect(statuses()).toEqual(['pending', 'awaiting_approval', 'denied'])
    expect(events.some((e) => e.type === 'approval.resolved')).toBe(true)
  })

  it('(c) allow_always → onAllowAlways callback and execution', async () => {
    const { router, ctx, approvals, events, onAllowAlways } = harness({ mode: 'ask' })
    const p = router.dispatch(call('write_note', { text: 'n' }), ctx)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'approval.requested')).toBe(true))
    const req = events.find((e) => e.type === 'approval.requested') as Extract<Event, { type: 'approval.requested' }>
    approvals.resolve(req.approvalId, 'allow_always')
    const out = await p
    expect(out.status).toBe('done')
    expect(out.artifacts).toHaveLength(1)
    expect(onAllowAlways).toHaveBeenCalledWith('write_note')
  })

  it('(c) destructive: canAllowAlways=false, allow_always downgraded to allow_once', async () => {
    const { router, ctx, approvals, events, onAllowAlways } = harness({ mode: 'bypass' })
    const p = router.dispatch(call('nuke', { text: 'n' }), ctx)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'approval.requested')).toBe(true))
    const req = events.find((e) => e.type === 'approval.requested') as Extract<Event, { type: 'approval.requested' }>
    expect(req.canAllowAlways).toBe(false)
    approvals.resolve(req.approvalId, 'allow_always')
    expect((await p).status).toBe('done')
    expect(onAllowAlways).not.toHaveBeenCalled()
  })

  it('(c) allow-listed write in ask mode runs without asking', async () => {
    const { router, ctx, events } = harness({ mode: 'ask', allowAlways: ['write_note'] })
    const out = await router.dispatch(call('write_note', { text: 'n' }), ctx)
    expect(out.status).toBe('done')
    expect(events.some((e) => e.type === 'approval.requested')).toBe(false)
  })

  it('(c) bypass runs writes without asking', async () => {
    const { router, ctx, events } = harness({ mode: 'bypass' })
    const out = await router.dispatch(call('write_note', { text: 'n' }), ctx)
    expect(out.status).toBe('done')
    expect(events.some((e) => e.type === 'approval.requested')).toBe(false)
  })

  it('(d) PreToolUse block → error with reason', async () => {
    const { router, ctx, hooks } = harness()
    hooks.add({ name: 'guard', events: ['PreToolUse'], run: async () => ({ block: { reason: '禁止' } }) })
    const out = await router.dispatch(call('echo', { text: 'x' }), ctx)
    expect(out.status).toBe('error')
    expect(out.result.content).toContain('禁止')
  })

  it('(d) PreToolUse rewrite → tool sees updated input (re-validated)', async () => {
    const { router, ctx, hooks } = harness()
    hooks.add({ name: 'rw', events: ['PreToolUse'], run: async () => ({ updatedInput: { text: 'rewritten' } }) })
    const out = await router.dispatch(call('echo', { text: 'x' }), ctx)
    expect(out.result.content).toBe('rewritten')
    hooks.add({ name: 'bad', events: ['PreToolUse'], run: async () => ({ updatedInput: { text: 5 } }) })
    const bad = await router.dispatch(call('echo', { text: 'x' }, 'cal_2'), ctx)
    expect(bad.status).toBe('error')
    expect(bad.result.content).toMatch(/hook 改写后的参数无效/)
  })

  it('(e) timeout → status timeout, tool signal aborted', async () => {
    const { router, ctx, statuses } = harness()
    const out = await router.dispatch(call('slow', { ms: 5000 }), ctx)
    expect(out.status).toBe('timeout')
    expect(out.isError).toBe(true)
    expect(out.result.content).toMatch(/超时/)
    expect(statuses().at(-1)).toBe('timeout')
  })

  it('(e) thrown error → error outcome; outer abort → 已中断', async () => {
    const { router, ctx, ac } = harness()
    const out = await router.dispatch(call('thrower', {}), ctx)
    expect(out.status).toBe('error')
    expect(out.result.content).toContain('kaboom')
    const p = router.dispatch(call('slow', { ms: 10 }, 'cal_2'), ctx)
    ac.abort()
    const aborted = await p
    expect(aborted.isError).toBe(true)
    expect(aborted.result.content).toBe('已中断')
  })

  it('(e) services and progress reach the tool; hidden tools are dispatchable', async () => {
    const { router, ctx, events } = harness()
    const out = await router.dispatch(call('hidden_helper', {}), ctx)
    expect(out.result.content).toEqual({ svc: 'svc', depth: 0 })
    expect(events.find((e) => e.type === 'tool.progress')).toMatchObject({ message: 'half', fraction: 0.5 })
  })

  it('(f) PostToolUse may replace output', async () => {
    const { router, ctx, hooks } = harness()
    hooks.add({ name: 'post', events: ['PostToolUse'], run: async (_e, p) => ({ updatedOutput: `[${String(p.output)}]` }) })
    const out = await router.dispatch(call('echo', { text: 'x' }), ctx)
    expect(out.result.content).toBe('[x]')
  })

  it('(g) truncation marker with policy and per-tool caps', async () => {
    const { router, ctx } = harness({ policy: { maxOutputChars: 10 } })
    const out = await router.dispatch(call('echo', { text: 'abcdefghij', n: 3 }), ctx)
    expect(out.result.content).toBe('abcdefghij' + TRUNCATION_MARKER(30, 10))
    const short = await router.dispatch(call('echo', { text: 'abc' }, 'cal_2'), ctx)
    expect(short.result.content).toBe('abc')
  })
})
