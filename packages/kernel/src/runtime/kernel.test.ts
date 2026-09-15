import { describe, expect, it } from 'vitest'
import {
  asCallId,
  asThreadId,
  asTurnId,
  newStepId,
  type ThreadId,
  type ThreadSettings,
  type ToolContext,
} from '@aiwc/protocol'
import { createKernel } from './kernel'
import { createMockModelClient } from './model/mock'
import { createTestServices, waitForEvent, type FakeTool } from './testing/fakes'
import { defaultTestConfig, userInput } from './testing/harness'
import { createDelegateTool } from './delegate'
import type { KernelInternal } from './types'

const make = (services: ReturnType<typeof createTestServices>, config = defaultTestConfig()): KernelInternal =>
  createKernel({ services, config: () => config, systemPrompt: { stable: '你是 AIWC。' } })

/** The context a desktop turn hands delegate_analysis. */
const delegateCtx = (threadId: ThreadId): ToolContext => ({
  threadId,
  turnId: asTurnId('trn_parent'),
  stepId: newStepId(),
  callId: asCallId('cal_delegate'),
  channel: 'desktop',
  profile: 'desktop-chat',
  signal: new AbortController().signal,
  services: {},
  progress: () => undefined,
  depth: 0,
})

/** Settings of a delegate child an older build persisted and a crash never cleaned up. */
const leftoverChildSettings: ThreadSettings = {
  permissionMode: 'bypass',
  profile: 'subagent',
  allowAlways: [],
  title: '子任务',
}

describe('kernel façade', () => {
  it('(8) resumes a thread from the rollout store and rebuilds history', async () => {
    const model = createMockModelClient({ steps: [{ text: '记住了。' }], loopLast: true })
    const services = createTestServices({
      model,
      auxiliary: createMockModelClient({ steps: [{ text: '自我介绍' }], loopLast: true }),
    })
    const k1 = make(services)
    const threadId = asThreadId('thr_resume')
    await k1.submit({
      type: 'thread.create',
      threadId,
      origin: { channel: 'desktop' },
      settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
    })
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
    expect(
      lastReq.history.some(
        (i) => i.type === 'user_message' && i.content[0]!.type === 'text' && i.content[0]!.text === '我叫小明',
      ),
    ).toBe(true)
    // world state was restored: no second full re-injection unless something changed
    const worldFragments = after!.items.filter((i) => i.type === 'context_fragment' && i.kind === 'world_state')
    expect(worldFragments).toHaveLength(1)
    await expect(k2.submit({ type: 'turn.interrupt', threadId: asThreadId('thr_nope') })).rejects.toThrow(
      /unknown thread/,
    )
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
    const explicit = await k.ensureThread(
      { channel: 'wechat-ilink', chatId: 'd', peerId: 'd' },
      { permissionMode: 'ask' },
    )
    expect((await k.getThread(explicit))!.record.settings.permissionMode).toBe('ask')
  })

  it('runOnce collects artifacts and rejects on abort', async () => {
    const model = createMockModelClient([
      { toolCalls: [{ name: 'export', input: {} }] },
      { text: '导出完成' },
      { text: '很长的内容会被中断', delayMs: 20, chunkSize: 1 },
    ])
    const exportTool: FakeTool = {
      name: 'export',
      parallelSafe: true,
      execute: async () => ({ content: 'ok', artifacts: [{ kind: 'file', title: '周报.md', path: '/tmp/x.md' }] }),
    }
    const services = createTestServices({
      model,
      tools: [exportTool],
      auxiliary: createMockModelClient({ steps: [{ text: '导出' }], loopLast: true }),
    })
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
      {
        tasks: [
          { title: '任务一', prompt: '查 A' },
          { title: '任务二', prompt: '查 B' },
        ],
      },
      {
        threadId: parent,
        turnId: 'trn' as never,
        stepId: 'stp' as never,
        callId: 'cal' as never,
        channel: 'desktop',
        profile: 'desktop-chat',
        signal: new AbortController().signal,
        services: {},
        progress: () => undefined,
        depth: 0,
      },
    )
    expect(result.isError).toBeFalsy()
    expect(String(result.content)).toContain('## 任务一')
    expect(String(result.content)).toContain('sess_1')
    expect(events).toEqual(['started', 'started', 'done', 'done'])
    expect(services.tools.builds.some((b) => b.profile === 'subagent' && b.depth === 1)).toBe(true)
    expect((await k.listThreads()).map((t) => t.threadId)).toEqual([parent])
    const nested = await tool.execute(
      { tasks: [{ title: 'x', prompt: 'y' }] },
      {
        threadId: parent,
        turnId: 'trn' as never,
        stepId: 'stp' as never,
        callId: 'cal' as never,
        channel: 'desktop',
        profile: 'subagent',
        signal: new AbortController().signal,
        services: {},
        progress: () => undefined,
        depth: 1,
      },
    )
    expect(nested.isError).toBe(true)
  })

  it('delegate children are ephemeral: no thread.created, nothing persisted, nothing listed', async () => {
    const model = createMockModelClient({ steps: [{ text: '结论：见 sess_1。' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services)
    const parent = await k.ensureThread({ channel: 'desktop' })
    const created: string[] = []
    k.events.on((e) => {
      if (e.type === 'thread.created') created.push(e.threadId)
    })
    const result = await createDelegateTool(() => k).execute(
      {
        tasks: [
          { title: '任务一', prompt: '查 A' },
          { title: '任务二', prompt: '查 B' },
        ],
      },
      delegateCtx(parent),
    )
    expect(result.isError).toBeFalsy()
    expect(created).toEqual([])
    expect(services.rollout.log.filter((op) => op === 'create')).toHaveLength(1)
    expect([...services.rollout.threads.keys()]).toEqual([parent])
  })

  it('listThreads and bot lookups never surface subagent threads, e.g. children a crash left behind', async () => {
    const services = createTestServices({ model: createMockModelClient({ steps: [{ text: 'ok' }], loopLast: true }) })
    const leftover = asThreadId('thr_leftover_child')
    await services.rollout.create({
      threadId: leftover,
      origin: { channel: 'desktop' },
      settings: leftoverChildSettings,
    })
    const leftoverBot = asThreadId('thr_leftover_bot_child')
    await services.rollout.create({
      threadId: leftoverBot,
      origin: { channel: 'wechat-ilink', chatId: 'wxid_x' },
      settings: leftoverChildSettings,
    })
    const k = make(services)
    const kept = await k.ensureThread({ channel: 'desktop' })
    expect((await k.listThreads()).map((t) => t.threadId)).toEqual([kept])
    // the exclusion applies before the limit, so leftovers cannot crowd real threads out of a page
    expect((await k.listThreads({ channel: 'desktop', limit: 1 })).map((t) => t.threadId)).toEqual([kept])
    const bot = await k.ensureThread({ channel: 'wechat-ilink', chatId: 'wxid_x' })
    expect(bot).not.toBe(leftoverBot)
    expect((await k.getThread(bot))!.record.settings.profile).toBe('wechat-bot')
  })

  it('warns when a resumed thread had rollout lines it could not read', async () => {
    const services = createTestServices({ model: createMockModelClient({ steps: [{ text: 'ok' }], loopLast: true }) })
    const id = asThreadId('thr_damaged')
    await services.rollout.create({
      threadId: id,
      origin: { channel: 'desktop' },
      settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
    })
    // what the file-backed store reports after dropping a torn and a wrong-shape line
    const resume = services.rollout.resume.bind(services.rollout)
    services.rollout.resume = async (threadId) => {
      const state = await resume(threadId)
      return state && { ...state, skippedLines: 2 }
    }
    const logs: Array<[string, string, unknown]> = []
    const k = createKernel({
      services,
      config: () => defaultTestConfig(),
      systemPrompt: { stable: '你是 AIWC。' },
      logger: (level, message, meta) => logs.push([level, message, meta]),
    })
    expect(await k.getThread(id)).toBeDefined()
    expect(logs).toEqual([['warn', expect.stringContaining('unreadable'), { threadId: id, skippedLines: 2 }]])
  })

  it('delegate children inherit the parent permission mode and model; an unknown parent is refused', async () => {
    const model = createMockModelClient({ steps: [{ text: '结论' }], loopLast: true })
    const services = createTestServices({ model })
    const k = make(services, defaultTestConfig({ defaultPermissionMode: 'bypass' }))
    const localModel = { providerId: 'ollama', modelId: 'qwen3' }
    const parent = await k.ensureThread({ channel: 'desktop' }, { permissionMode: 'ask', model: localModel })
    const result = await createDelegateTool(() => k).execute(
      { tasks: [{ title: '任务一', prompt: '查 A' }] },
      delegateCtx(parent),
    )
    expect(result.isError).toBeFalsy()
    const childBuilds = services.tools.builds.filter((b) => b.profile === 'subagent')
    expect(childBuilds.length).toBeGreaterThan(0)
    expect(childBuilds.map((b) => b.permissionMode)).toEqual(childBuilds.map(() => 'ask'))
    // only the child sampled, and it stayed on the parent's (local) model instead of the app default
    expect(services.models.selections.length).toBeGreaterThan(0)
    expect(services.models.selections).toEqual(services.models.selections.map(() => localModel))

    await expect(
      k.runChild({
        parentThreadId: asThreadId('thr_gone'),
        origin: { channel: 'desktop' },
        input: userInput('查 C'),
        depth: 1,
        maxSteps: 12,
        label: '任务三',
      }),
    ).rejects.toThrow(/unknown parent thread/)
  })
})
