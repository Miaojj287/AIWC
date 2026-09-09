import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, newItemId, type Event, type ModelClient, type ThreadOrigin, type ThreadSettings, type ToolDefinition } from '@aiwc/protocol'
import type { KernelServices, ToolRouterFactory } from '../ports'
import { createApprovalGate, createToolRegistry, createToolRouterFactory } from '../tooling'
import { createEmitter } from './emitter'
import { createMockModelClient } from './model/mock'
import { Thread } from './thread'
import { collectEvents, createTestServices, testOrigin, testSettings, testThreadId, waitForEvent, type FakeTool } from './testing/fakes'
import { createThreadHarness, defaultTestConfig, userInput } from './testing/harness'
import type { KernelConfig } from './types'
import { sleep } from './util/deferred'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ToolDefinition<any, any>

/** Real registry + router + approval gate (the production funnel) over the in-memory fakes for everything else. */
function servicesWithRealRouter(model: ModelClient, defs: AnyTool[]): KernelServices {
  const base = createTestServices({ model })
  const registry = createToolRegistry()
  for (const d of defs) registry.register(d)
  const approvals = createApprovalGate()
  const tools = createToolRouterFactory({ registry, approvals, hooks: base.hooks, services: {} })
  return { ...base, tools, approvals }
}

async function makeThread(services: KernelServices, opts: { origin?: ThreadOrigin; settings?: Partial<ThreadSettings>; config?: Partial<KernelConfig> } = {}) {
  const emitter = createEmitter()
  const events = collectEvents(emitter.on)
  const config = defaultTestConfig(opts.config)
  const origin = opts.origin ?? testOrigin()
  const settings = testSettings(opts.settings)
  const threadId = testThreadId()
  await services.rollout.create({ threadId, origin, settings })
  const thread = new Thread({ services, config: () => config, systemPrompt: { stable: '你是 AIWC。' }, emit: emitter.emit }, { threadId, origin, settings })
  return { thread, emitter, events }
}

const readTool = (name: string, content = 'ok'): AnyTool =>
  defineTool({ name, description: name, inputSchema: z.object({}).passthrough(), profiles: ['desktop-chat', 'wechat-bot'], risk: 'read', parallelSafe: true, execute: async () => ({ content }) })

const until = async (cond: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await sleep(5)
  }
}

describe('Thread — permission mode & allow-list reach the router', () => {
  it('bypass + read tool on a headless wechat thread runs without any approval.requested', async () => {
    const model = createMockModelClient([{ toolCalls: [{ name: 'lookup', input: {} }] }, { text: '查到了。' }])
    const services = servicesWithRealRouter(model, [readTool('lookup')])
    const { thread, events } = await makeThread(services, {
      origin: { channel: 'wechat-ilink', chatId: 'wxid_peer', peerId: 'wxid_peer' },
      settings: { profile: 'wechat-bot', permissionMode: 'bypass' },
      config: { turnTimeoutMs: 2000 },
    })
    const result = await (await thread.startTurn(userInput('在吗'), 'start')).promise
    expect(result).toMatchObject({ status: 'completed', text: '查到了。' })
    expect(events.types()).not.toContain('approval.requested')
    const done = events.events.find((e) => e.type === 'tool.call' && e.status === 'done')
    expect(done).toBeDefined()
  })

  it('allow_always is persisted into ThreadSettings and the next call is not asked again', async () => {
    const model = createMockModelClient([{ toolCalls: [{ name: 'note_write', input: { text: 'a' } }] }, { text: '记下了' }, { toolCalls: [{ name: 'note_write', input: { text: 'b' } }] }, { text: '又记下了' }])
    const writeTool: AnyTool = defineTool({
      name: 'note_write',
      description: 'write',
      inputSchema: z.object({ text: z.string() }),
      profiles: ['desktop-chat'],
      risk: 'write',
      parallelSafe: false,
      execute: async () => ({ content: 'written' }),
    })
    const services = servicesWithRealRouter(model, [writeTool])
    const { thread, emitter, events } = await makeThread(services, { settings: { permissionMode: 'ask' } })

    const requested = waitForEvent(emitter.on, 'approval.requested')
    const handle = await thread.startTurn(userInput('记一下'), 'start')
    const req = await requested
    expect(req.toolName).toBe('note_write')
    await thread.submit({ type: 'approval.resolve', threadId: thread.id, approvalId: req.approvalId, decision: 'allow_always' })
    expect(await handle.promise).toMatchObject({ status: 'completed' })
    expect(thread.settings.allowAlways).toEqual(['note_write'])
    expect(events.types()).toContain('thread.settings')
    expect(services.rollout.linesOf(thread.id).some((l) => l.type === 'settings' && l.settings.allowAlways.includes('note_write'))).toBe(true)

    const asksBefore = events.types().filter((t) => t === 'approval.requested').length
    expect(await (await thread.startTurn(userInput('再记一下'), 'start')).promise).toMatchObject({ status: 'completed', text: '又记下了' })
    expect(events.types().filter((t) => t === 'approval.requested').length).toBe(asksBefore)
  })
})

describe('Thread — tool output cap', () => {
  it('a tool with maxOutputChars 32k returning 30k chars is recorded untruncated; the default cap still applies to others', async () => {
    const model = createMockModelClient([{ toolCalls: [{ name: 'big_read', input: {} }, { name: 'plain_read', input: {} }] }, { text: '完成' }])
    const big: AnyTool = { ...readTool('big_read', 'a'.repeat(30_000)), maxOutputChars: 32_000 }
    const plain = readTool('plain_read', 'b'.repeat(20_000))
    const services = servicesWithRealRouter(model, [big, plain])
    const { thread } = await makeThread(services)
    expect(await (await thread.startTurn(userInput('查'), 'start')).promise).toMatchObject({ status: 'completed' })
    const results = thread.context.all().filter((i) => i.type === 'tool_result')
    const bigResult = results.find((r) => r.toolName === 'big_read')!
    const plainResult = results.find((r) => r.toolName === 'plain_read')!
    expect(bigResult.output.type === 'text' && bigResult.output.text.length).toBe(30_000)
    expect(bigResult.output.type === 'text' && bigResult.output.text).not.toContain('截断')
    expect(plainResult.output.type === 'text' && plainResult.output.text.startsWith('b'.repeat(16_000))).toBe(true)
    expect(plainResult.output.type === 'text' && plainResult.output.text.length).toBeLessThan(17_000)
    // exactly one truncation marker (the router's), never two
    expect(plainResult.output.type === 'text' && plainResult.output.text.split('截断').length).toBe(2)
  })
})

describe('Thread — op serialisation', () => {
  it('two concurrent turn.start ops during an active turn leave exactly one live turn', async () => {
    const long = { text: '很长很长很长很长的一段回复内容一直在写。', delayMs: 10, chunkSize: 2 }
    const model = createMockModelClient({ steps: [long], loopLast: true })
    const aux = createMockModelClient({ steps: [{ text: '标题' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    await h.thread.startTurn(userInput('一'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    const p1 = h.thread.submit({ type: 'turn.start', threadId: h.thread.id, input: userInput('二') })
    const p2 = h.thread.submit({ type: 'turn.start', threadId: h.thread.id, input: userInput('三') })
    await Promise.all([p1, p2])
    await h.thread.activeTurn?.promise
    const types = h.events.types()
    expect(types.filter((t) => t === 'turn.started')).toHaveLength(3)
    expect(types.filter((t) => t === 'turn.completed')).toHaveLength(1)
    const aborted = h.events.events.filter((e): e is Extract<Event, { type: 'turn.aborted' }> => e.type === 'turn.aborted')
    expect(aborted.map((a) => a.reason)).toEqual(['replaced', 'replaced'])
    // the second replacement lands before turn B ever samples, so B produces no model request: 2 or 3 are both fine,
    // what matters is that no two turns ran side by side
    expect(model.requests.length).toBeGreaterThanOrEqual(2)
    expect(model.requests.length).toBeLessThanOrEqual(3)
    const starts = h.events.events.filter((e) => e.type === 'turn.started').map((e) => (e.type === 'turn.started' ? e.turnId : ''))
    const terminals = h.events.events.filter((e) => e.type === 'turn.completed' || e.type === 'turn.aborted')
    // every turn terminated before the next one started (events are in emission order)
    for (let i = 0; i < starts.length - 1; i++) {
      const startIdx = h.events.events.findIndex((e) => e.type === 'turn.started' && e.turnId === starts[i + 1])
      const endIdx = h.events.events.findIndex((e) => (e.type === 'turn.completed' || e.type === 'turn.aborted') && e.turnId === starts[i])
      expect(endIdx).toBeGreaterThanOrEqual(0)
      expect(endIdx).toBeLessThan(startIdx)
    }
    expect(terminals).toHaveLength(3)
    expect(h.thread.activeTurn).toBeUndefined()
  })

  it('a turn.start racing shutdown is rejected and nothing runs after the thread closed', async () => {
    const model = createMockModelClient([{ text: '很长很长的一段回复内容一直在写。', delayMs: 10, chunkSize: 2 }, { text: '二' }])
    const aux = createMockModelClient({ steps: [{ text: '标题' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    const first = await h.thread.startTurn(userInput('一'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    const shutdown = h.thread.shutdown()
    const late = h.thread.submit({ type: 'turn.start', threadId: h.thread.id, input: userInput('二') })
    await shutdown
    await expect(late).rejects.toThrow(/shut down/)
    expect(await first.promise).toMatchObject({ status: 'aborted', reason: 'interrupted' })
    expect(h.thread.isClosed).toBe(true)
    expect(h.events.types().filter((t) => t === 'turn.completed')).toHaveLength(0)
    expect(h.events.types().filter((t) => t === 'turn.started')).toHaveLength(1)
    expect(model.requests).toHaveLength(1)
  })
})

describe('Thread — failure paths', () => {
  it('a crash inside the turn still emits turn.aborted, records turn_aborted and flushes', async () => {
    const model = createMockModelClient([{ text: 'never' }])
    const base = createTestServices({ model })
    const tools: ToolRouterFactory = {
      build() {
        throw new Error('router exploded')
      },
    }
    const services: KernelServices = { ...base, tools }
    const { thread, events } = await makeThread(services)
    const result = await (await thread.startTurn(userInput('x'), 'start')).promise
    expect(result).toMatchObject({ status: 'aborted', reason: 'error' })
    const types = events.types()
    expect(types.filter((type) => type !== 'thread.title')[0]).toBe('turn.started')
    expect(types).toContain('error')
    expect(types[types.length - 1]).toBe('turn.aborted')
    const err = events.events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.error.message).toContain('router exploded')
    expect(err && err.type === 'error' && err.actions.length).toBeGreaterThan(0)
    expect(thread.context.all().at(-1)).toMatchObject({ type: 'turn_aborted', reason: 'error' })
    const log = base.rollout.log
    expect(log.lastIndexOf('flush')).toBeGreaterThan(log.findIndex((l) => l.includes('turn_aborted')))
    expect(thread.activeTurn).toBeUndefined()
  })

  it('an abandoned exclusive tool releases the lock so the next turn is not blocked, and its late events are dropped', async () => {
    const model = createMockModelClient([{ toolCalls: [{ name: 'hang_write', input: {} }] }, { toolCalls: [{ name: 'read', input: {} }] }, { text: '好' }])
    const hang: FakeTool = { name: 'hang_write', parallelSafe: false, risk: 'write', execute: () => sleep(600).then(() => ({ content: 'late' })) }
    const read: FakeTool = { name: 'read', parallelSafe: true, risk: 'read', execute: async () => ({ content: 'fast' }) }
    const aux = createMockModelClient({ steps: [{ text: '标题' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux, tools: [hang, read] })

    const first = await h.thread.startTurn(userInput('挂住'), 'start')
    await until(() => h.events.events.some((e) => e.type === 'tool.call' && e.toolName === 'hang_write' && e.status === 'running'))
    first.interrupt()
    expect(await first.promise).toMatchObject({ status: 'aborted', reason: 'interrupted' })

    const t0 = Date.now()
    const second = await h.thread.startTurn(userInput('再查'), 'start')
    await until(() => h.events.events.some((e) => e.type === 'tool.call' && e.toolName === 'read' && e.status === 'running'))
    expect(Date.now() - t0).toBeLessThan(300)
    expect(await second.promise).toMatchObject({ status: 'completed', text: '好' })

    // let the zombie finish: its 'done' event must not surface under the dead turn
    await sleep(650)
    const hangDone = h.events.events.filter((e) => e.type === 'tool.call' && e.toolName === 'hang_write' && e.status === 'done')
    expect(hangDone).toHaveLength(0)
    const hangResult = h.thread.context.all().find((i) => i.type === 'tool_result' && i.toolName === 'hang_write')
    expect(hangResult && hangResult.type === 'tool_result' && hangResult.isError).toBe(true)
  })
})

describe('Thread — manual compaction', () => {
  it('thread.compact during an active turn is refused with an error event and the turn still completes', async () => {
    const model = createMockModelClient([{ text: '很长很长很长很长的一段回复内容一直在写。', delayMs: 10, chunkSize: 2 }])
    const aux = createMockModelClient({ steps: [{ text: '摘要' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    const handle = await h.thread.startTurn(userInput('一'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    await h.thread.submit({ type: 'thread.compact', threadId: h.thread.id })
    const err = h.events.events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.error.code).toBe('compaction_refused')
    expect(err && err.type === 'error' && err.error.message).toContain('回合')
    expect(await handle.promise).toMatchObject({ status: 'completed' })
    expect(h.events.types()).not.toContain('context.compacted')
    expect(h.services.hooks.calls.map((c) => c.event)).not.toContain('PreCompact')
  })
})

describe('Thread — title generation', () => {
  it('shutdown aborts an in-flight title job and nothing touches the rollout index afterwards', async () => {
    const model = createMockModelClient([{ text: '好的。' }])
    const aux = createMockModelClient({ steps: [{ text: '一个慢慢生成的标题一个慢慢生成的标题', delayMs: 20, chunkSize: 1 }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    await (await h.thread.startTurn(userInput('你好'), 'start')).promise
    await until(() => aux.requests.length === 1)
    const shutdown = h.thread.shutdown()
    await shutdown
    const updates = h.services.rollout.log.filter((l) => l === 'updateMeta').length
    await sleep(120)
    expect(h.thread.isClosed).toBe(true)
    expect(h.events.types().filter((type) => type === 'thread.title')).toHaveLength(1)
    expect(h.services.rollout.threads.get(h.thread.id)?.meta.title).toBe('你好')
    expect(h.thread.settings.title).toBeUndefined()
    expect(h.services.rollout.log.filter((l) => l === 'updateMeta').length).toBe(updates)
    expect(aux.requests[0]!.signal.aborted).toBe(true)
  })
})

describe('Thread — rollback keeps thread metadata', () => {
  it('rollback and clear use RolloutStore.rewrite() when present, keeping meta and the compaction checkpoint', async () => {
    const model = createMockModelClient({ steps: [{ text: '好' }], loopLast: true })
    const h = await createThreadHarness({ model, rolloutRewrite: true })
    h.thread.updateSettings({ title: '置顶的会话' })
    await (await h.thread.startTurn(userInput('一'), 'start')).promise
    await (await h.thread.startTurn(userInput('二'), 'start')).promise
    const anchor = h.thread.context.all().find((i) => i.type === 'assistant_message')!
    h.thread.record([{ type: 'compaction_summary', id: newItemId(), createdAt: 5, summary: '前情', foldedItemCount: 2, foldedThroughId: anchor.id, tokenEstimate: 2 }])
    await (await h.thread.startTurn(userInput('三'), 'start')).promise
    // the index title is what the store preserves (kernel.updateMeta writes both settings.title and the index)
    await h.services.rollout.updateMeta(h.thread.id, { pinned: true, title: '置顶的会话' })
    const createdAt = h.services.rollout.threads.get(h.thread.id)!.meta.createdAt
    const logBefore = h.services.rollout.log.length

    await h.thread.rollback(1)
    const log = h.services.rollout.log.slice(logBefore)
    expect(log).toContain('rewrite')
    expect(log).not.toContain('remove')
    expect(log).not.toContain('create')
    const meta = h.services.rollout.threads.get(h.thread.id)!.meta
    expect(meta).toMatchObject({ pinned: true, title: '置顶的会话', createdAt })
    const lines = h.services.rollout.linesOf(h.thread.id)
    expect(lines.find((l) => l.type === 'compacted')).toMatchObject({ type: 'compacted', foldedThroughId: anchor.id })
    expect(h.services.rollout.itemsOf(h.thread.id).filter((i) => i.type === 'user_message')).toHaveLength(2)
    expect(h.services.rollout.itemsOf(h.thread.id).some((i) => i.type === 'compaction_summary')).toBe(true)

    await h.thread.clear()
    expect(h.services.rollout.itemsOf(h.thread.id)).toHaveLength(0)
    expect(h.services.rollout.linesOf(h.thread.id).some((l) => l.type === 'compacted')).toBe(false)
    expect(h.services.rollout.threads.get(h.thread.id)!.meta).toMatchObject({ pinned: true, title: '置顶的会话', createdAt })
  })

  it('a failing rewrite surfaces rollout_write_failed and rejects the op', async () => {
    const model = createMockModelClient({ steps: [{ text: '好' }], loopLast: true })
    const h = await createThreadHarness({ model, rolloutRewrite: true })
    await (await h.thread.startTurn(userInput('一'), 'start')).promise
    h.services.rollout.rewrite = async () => {
      throw new Error('EROFS')
    }
    await expect(h.thread.rollback(1)).rejects.toThrow('EROFS')
    const err = h.events.events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.error.code).toBe('rollout_write_failed')
  })

  it('rollback and clear preserve pinned / archived / title (fallback path without rewrite)', async () => {
    const model = createMockModelClient({ steps: [{ text: '好' }], loopLast: true })
    const h = await createThreadHarness({ model })
    h.thread.updateSettings({ title: '置顶的会话' })
    await (await h.thread.startTurn(userInput('一'), 'start')).promise
    await (await h.thread.startTurn(userInput('二'), 'start')).promise
    await h.services.rollout.updateMeta(h.thread.id, { pinned: true })

    await h.thread.rollback(1)
    let meta = h.services.rollout.threads.get(h.thread.id)!.meta
    expect(meta.pinned).toBe(true)
    expect(meta.title).toBe('置顶的会话')
    expect(h.services.rollout.itemsOf(h.thread.id).filter((i) => i.type === 'user_message')).toHaveLength(1)

    await h.services.rollout.updateMeta(h.thread.id, { archived: true })
    await h.thread.clear()
    meta = h.services.rollout.threads.get(h.thread.id)!.meta
    expect(meta.pinned).toBe(true)
    expect(meta.archived).toBe(true)
    expect(h.services.rollout.itemsOf(h.thread.id)).toHaveLength(0)
  })
})
