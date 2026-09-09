import { describe, expect, it } from 'vitest'
import { asThreadId } from '@aiwc/protocol'
import { createKernel } from './kernel'
import { createMockModelClient } from './model/mock'
import { createTestServices, waitForEvent, type FakeTool } from './testing/fakes'
import { defaultTestConfig, userInput } from './testing/harness'
import { createDelegateTool } from './delegate'
import type { KernelInternal } from './types'

const make = (services: ReturnType<typeof createTestServices>, config = defaultTestConfig()): KernelInternal =>
  createKernel({ services, config: () => config, systemPrompt: { stable: '你是 AIWC。' } })

describe('kernel façade', () => {
  it('(8) resumes a thread from the rollout store and rebuilds history', async () => {
    const model = createMockModelClient({ steps: [{ text: '记住了。' }], loopLast: true })
    const services = createTestServices({ model, auxiliary: createMockModelClient({ steps: [{ text: '自我介绍' }], loopLast: true }) })
    const k1 = make(services)
    const threadId = asThreadId('thr_resume')
    await k1.submit({ type: 'thread.create', threadId, origin: { channel: 'desktop' }, settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] } })
    const done = waitForEvent(k1.events.on, 'turn.completed')
    await k1.submit({ type: 'turn.start', threadId, input: userInput('我叫小明') })
    await done
    await k1.submit({ type: 'thread.settings', threadId, patch: { permissionMode: 'bypass' } })
    const before = (await k1.getThread(threadId))!
    await k1.shutdown()

    const k2 = make(services)
    const after = await k2.getThread(threadId)
    expect(after).toBeDefined()
    expect(after!.items.map((i) => i.type)).toEqual(before.items.map((i) => i.type))
    expect(after!.record.settings.permissionMode).toBe('bypass')
    const second = await k2.runOnce(threadId, userInput('我叫什么'))
    expect(second.text).toBe('记住了。')
    const lastReq = model.requests.at(-1)!
    expect(lastReq.history.some((i) => i.type === 'user_message' && i.content[0]!.type === 'text' && i.content[0]!.text === '我叫小明')).toBe(true)
    // world state was restored: no second full re-injection unless something changed
    const worldFragments = after!.items.filter((i) => i.type === 'context_fragment' && i.kind === 'world_state')
    expect(worldFragments).toHaveLength(1)
    await expect(k2.submit({ type: 'turn.interrupt', threadId: asThreadId('thr_nope') })).rejects.toThrow(/unknown thread/)
  })

  it('ensureThread reuses the thread bound to a wechat chat and applies channel profiles', async () => {
    const model = createMockModelClient({ steps: [{ text: 'ok' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services)
    const a = await k.ensureThread({ channel: 'wechat-ilink', chatId: 'wxid_x', peerId: 'wxid_x' })
    const b = await k.ensureThread({ channel: 'wechat-ilink', chatId: 'wxid_x', peerId: 'wxid_x' })
    expect(a).toBe(b)
    const rec = (await k.getThread(a))!.record
    expect(rec.settings.profile).toBe('wechat-bot')
    const c = await k.ensureThread({ channel: 'cron' })
    expect((await k.getThread(c))!.record.settings.profile).toBe('cron')
    expect((await k.listThreads()).length).toBe(2)
    await k.removeThread(c)
    expect((await k.listThreads()).length).toBe(1)
  })

  it('concurrent ensureThread calls for the same bot chat share one thread', async () => {
    const model = createMockModelClient({ steps: [{ text: 'ok' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services)
    const origin = { channel: 'wechat-ilink' as const, chatId: 'chat_1', peerId: 'chat_1' }
    const [a, b, c] = await Promise.all([k.ensureThread(origin), k.ensureThread(origin), k.ensureThread(origin)])
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect((await k.listThreads({ channel: 'wechat-ilink' })).map((t) => t.threadId)).toEqual([a])
    // a later call (no longer in flight) still finds it
    expect(await k.ensureThread(origin)).toBe(a)
  })

  it('(11) group origins get one thread per (chat, member); DMs stay keyed by chat', async () => {
    const model = createMockModelClient({ steps: [{ text: 'ok' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services)
    const room = 'room@chatroom'
    const [a1, b1, a2, b2] = await Promise.all([
      k.ensureThread({ channel: 'wechat-ilink', chatId: room, peerId: 'wxid_a' }),
      k.ensureThread({ channel: 'wechat-ilink', chatId: room, peerId: 'wxid_b' }),
      k.ensureThread({ channel: 'wechat-ilink', chatId: room, peerId: 'wxid_a' }),
      k.ensureThread({ channel: 'wechat-ilink', chatId: room, peerId: 'wxid_b' }),
    ])
    expect(a1).toBe(a2)
    expect(b1).toBe(b2)
    expect(a1).not.toBe(b1)
    // a DM with the room's id (peerId === chatId) is not any member's thread
    const dm = await k.ensureThread({ channel: 'wechat-ilink', chatId: 'wxid_a', peerId: 'wxid_a' })
    const dmNoPeer = await k.ensureThread({ channel: 'wechat-ilink', chatId: 'wxid_a' })
    expect(dm).toBe(dmNoPeer)
    expect(dm).not.toBe(a1)
    expect((await k.listThreads({ channel: 'wechat-ilink' })).length).toBe(3)
    // after a restart the same keys resolve from the rollout store
    await k.shutdown()
    const k2 = make(services)
    expect(await k2.ensureThread({ channel: 'wechat-ilink', chatId: room, peerId: 'wxid_b' })).toBe(b1)
    expect(await k2.ensureThread({ channel: 'wechat-ilink', chatId: 'wxid_a' })).toBe(dm)
    expect((await k2.listThreads({ channel: 'wechat-ilink' })).length).toBe(3)
  })

  it('headless origins default to bypass while desktop follows the configured default', async () => {
    const model = createMockModelClient({ steps: [{ text: 'ok' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services, defaultTestConfig({ defaultPermissionMode: 'ask' }))
    const cron = await k.ensureThread({ channel: 'cron' })
    expect((await k.getThread(cron))!.record.settings.permissionMode).toBe('bypass')
    const bot = await k.ensureThread({ channel: 'wechat-ui', chatId: 'c', peerId: 'c' })
    expect((await k.getThread(bot))!.record.settings.permissionMode).toBe('bypass')
    const desktop = await k.ensureThread({ channel: 'desktop' })
    expect((await k.getThread(desktop))!.record.settings.permissionMode).toBe('ask')
    // an explicit patch still wins
    const explicit = await k.ensureThread({ channel: 'wechat-ilink', chatId: 'd', peerId: 'd' }, { permissionMode: 'ask' })
    expect((await k.getThread(explicit))!.record.settings.permissionMode).toBe('ask')
  })

  it('runOnce collects artifacts and rejects on abort', async () => {
    const model = createMockModelClient([{ toolCalls: [{ name: 'export', input: {} }] }, { text: '导出完成' }, { text: '很长的内容会被中断', delayMs: 20, chunkSize: 1 }])
    const exportTool: FakeTool = { name: 'export', parallelSafe: true, execute: async () => ({ content: 'ok', artifacts: [{ kind: 'file', title: '周报.md', path: '/tmp/x.md' }] }) }
    const services = createTestServices({ model, tools: [exportTool], auxiliary: createMockModelClient({ steps: [{ text: '导出' }], loopLast: true }) })
    const k = make(services)
    const id = await k.ensureThread({ channel: 'desktop' })
    const r = await k.runOnce(id, userInput('导出'))
    expect(r.text).toBe('导出完成')
    expect(r.artifacts.map((a) => a.title)).toEqual(['周报.md'])
    const ac = new AbortController()
    const p = k.runOnce(id, userInput('再来'), { signal: ac.signal })
    await waitForEvent(k.events.on, 'text.delta')
    ac.abort()
    await expect(p).rejects.toThrow(/aborted: interrupted/)
  })

  it('rollback drops turns and rewrites persistence; clear empties the thread', async () => {
    const model = createMockModelClient({ steps: [{ text: '好' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services)
    const id = await k.ensureThread({ channel: 'desktop' })
    await k.runOnce(id, userInput('一'))
    await k.runOnce(id, userInput('二'))
    await k.submit({ type: 'thread.rollback', threadId: id, turns: 1 })
    const after = (await k.getThread(id))!
    expect(after.items.filter((i) => i.type === 'user_message')).toHaveLength(1)
    expect(services.rollout.itemsOf(id).filter((i) => i.type === 'user_message')).toHaveLength(1)
    await k.submit({ type: 'thread.clear', threadId: id })
    expect((await k.getThread(id))!.items).toHaveLength(0)
    expect(services.rollout.itemsOf(id)).toHaveLength(0)
  })

  it('delegate_analysis runs subagent children with depth 1 and returns conclusions', async () => {
    const model = createMockModelClient({ steps: [{ text: '结论：A 会话在 sess_1 提到过。' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services)
    const tool = createDelegateTool(() => k)
    const parent = await k.ensureThread({ channel: 'desktop' })
    const events: string[] = []
    k.events.on((e) => {
      if (e.type === 'subagent') events.push(e.status)
    })
    const result = await tool.execute(
      { tasks: [{ title: '任务一', prompt: '查 A' }, { title: '任务二', prompt: '查 B' }] },
      { threadId: parent, turnId: 'trn' as never, stepId: 'stp' as never, callId: 'cal' as never, channel: 'desktop', profile: 'desktop-chat', signal: new AbortController().signal, services: {}, progress: () => undefined, depth: 0 },
    )
    expect(result.isError).toBeFalsy()
    expect(String(result.content)).toContain('## 任务一')
    expect(String(result.content)).toContain('sess_1')
    expect(events).toEqual(['started', 'started', 'done', 'done'])
    expect(services.tools.builds.some((b) => b.profile === 'subagent' && b.depth === 1)).toBe(true)
    expect((await k.listThreads()).map((t) => t.threadId)).toEqual([parent])
    const nested = await tool.execute({ tasks: [{ title: 'x', prompt: 'y' }] }, { threadId: parent, turnId: 'trn' as never, stepId: 'stp' as never, callId: 'cal' as never, channel: 'desktop', profile: 'subagent', signal: new AbortController().signal, services: {}, progress: () => undefined, depth: 1 })
    expect(nested.isError).toBe(true)
  })
})
