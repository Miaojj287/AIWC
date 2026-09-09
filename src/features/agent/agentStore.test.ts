// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, type AiwcBridge, type Event, type EventMap, type HistoryItem, type Op, type ThreadId, type ThreadSummary, type TurnId } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests } from '@/platform/configStore'
import { __resetShellStoreForTests, useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { clearToasts, getToasts } from '@/kit'
import { __resetAgentStoreForTests, subscribeAgentEvents, useAgentStore } from './agentStore'
import { SCRATCH_DRAFT_KEY } from './model'

interface FakeBridge extends AiwcBridge {
  ops: Op[]
  calls: string[]
  emit(e: Event): void
}

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }

function fakeBridge(threads: ThreadSummary[] = [], history: Record<string, HistoryItem[]> = {}): FakeBridge {
  const listeners = new Set<(e: Event) => void>()
  const ops: Op[] = []
  const calls: string[] = []
  return {
    runtime: 'web',
    platform: 'darwin',
    ops,
    calls,
    emit: (e) => listeners.forEach((l) => l(e)),
    on: ((channel: string, listener: (p: unknown) => void) => {
      if (channel === 'agent:event') listeners.add(listener as (e: Event) => void)
      return () => listeners.delete(listener as (e: Event) => void)
    }) as AiwcBridge['on'],
    invoke: (async (channel: string, req: unknown) => {
      calls.push(channel)
      switch (channel) {
        case 'config:get':
          return defaultConfig()
        case 'agent:listThreads':
          return threads
        case 'agent:getThread': {
          const { threadId } = req as { threadId: ThreadId }
          const summary = threads.find((t) => t.threadId === threadId) ?? { threadId, title: '新会话', origin: { channel: 'desktop' }, settings, createdAt: 1, updatedAt: 1, pinned: false }
          return { summary, items: history[threadId] ?? [] }
        }
        case 'agent:submit':
          ops.push(req as Op)
          return undefined
        case 'agent:listModels':
          return [{ providerId: 'p', modelId: 'm', label: 'M', contextWindow: 128_000, local: true, supportsTools: true }]
        case 'agent:listSkills':
          return [{ name: 'weekly', description: '周报', command: '/周报', source: 'builtin' }]
        case 'agent:suggestPrompts':
          return ['建议一', '建议二', '建议三']
        case 'agent:renameThread':
        case 'agent:pinThread':
        case 'agent:deleteThread':
          return undefined
        case 'agent:exportThread':
          return { path: '/tmp/x.md' }
        default:
          throw new Error(`unexpected ${channel}`)
      }
    }) as AiwcBridge['invoke'],
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

const t1: ThreadSummary = { threadId: 'thr_1' as ThreadId, title: '周报草稿', origin: { channel: 'desktop' }, settings, createdAt: 1, updatedAt: 10, pinned: false }
const t2: ThreadSummary = { threadId: 'thr_2' as ThreadId, title: '密钥获取逻辑', origin: { channel: 'desktop' }, settings, createdAt: 1, updatedAt: 5, pinned: false }

const store = () => useAgentStore.getState()

beforeEach(() => {
  __resetAgentStoreForTests()
  __resetConfigStoreForTests()
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
  clearToasts()
})
afterEach(() => __setBridgeForTests(undefined))

describe('agentStore.hydrate', () => {
  it('lists desktop threads, opens the most recent one and loads its history', async () => {
    const turnId = 'trn_1' as TurnId
    const bridge = fakeBridge([t2, t1], {
      thr_1: [{ type: 'user_message', id: 'u1' as never, turnId, createdAt: 1, content: [{ type: 'text', text: '你好' }], mentions: [] }],
    })
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    expect(store().threads.map((t) => t.threadId)).toEqual(['thr_1', 'thr_2'])
    expect(store().openIds).toEqual(['thr_1'])
    expect(store().activeThreadId).toBe('thr_1')
    expect(store().views.thr_1?.loaded).toBe(true)
    expect(store().views.thr_1?.items[0]).toEqual(expect.objectContaining({ kind: 'user' }))
    expect(store().models).toHaveLength(1)
    expect(store().skills[0]?.command).toBe('/周报')
  })

  it('loads suggestions for an empty thread', async () => {
    __setBridgeForTests(fakeBridge([t1]))
    await store().hydrate()
    await flush()
    expect(store().views.thr_1?.suggestions).toEqual(['建议一', '建议二', '建议三'])
  })
})

describe('agentStore threads & ops', () => {
  it('creates a thread with settings from config and a context chip, then sends the draft as turn.start', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    const id = await store().createThread({ contextRef: { kind: 'session', id: 's1', label: '产品市场群' } })
    expect(store().openIds).toEqual([id])
    expect(store().activeThreadId).toBe(id)
    expect(store().focusSeq).toBe(1)
    expect(bridge.ops).toEqual([])
    expect(store().localIds).toEqual([id])
    expect(store().drafts[id]?.mentions).toEqual([{ kind: 'session', id: 's1', label: '产品市场群' }])

    store().setDraft(id, { text: ' 总结今天 ' })
    await store().send(id)
    expect(bridge.ops[0]).toMatchObject({ type: 'thread.create', settings: { permissionMode: 'ask', profile: 'desktop-chat' } })
    expect(store().localIds).toEqual([])
    expect(store().threads[0]?.title).toBe('总结今天')
    const turn = bridge.ops.find((o) => o.type === 'turn.start')
    if (turn?.type !== 'turn.start') throw new Error()
    expect(turn.input).toEqual({ content: [{ type: 'text', text: '总结今天' }], mentions: [{ kind: 'session', id: 's1', label: '产品市场群' }] })
    expect(turn.mode).toBe('start')
    expect(store().drafts[id]).toEqual({ text: '', mentions: [] })
  })

  it('closes the last unsent tab without creating history and requests collapse', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    let collapsed = false
    const dispose = onCommand('agent.toggleCollapsed', () => { collapsed = true })
    try {
      const id = await store().createThread()
      await store().updateSettings(id, { permissionMode: 'bypass' })
      store().closeThread(id)
      expect(collapsed).toBe(true)
      expect(store().threads).toEqual([])
      expect(store().localIds).toEqual([])
      expect(store().views[id]).toBeUndefined()
      expect(bridge.ops).toEqual([])
    } finally { dispose() }
  })

  it('deduplicates simultaneous requests to open an initial tab', async () => {
    __setBridgeForTests(fakeBridge())
    const ids = await Promise.all([store().ensureActiveThread(), store().ensureActiveThread()])
    expect(ids[0]).toBe(ids[1])
    expect(store().openIds).toHaveLength(1)
  })

  it('folds live events into the open view and reacts with side effects', async () => {
    const bridge = fakeBridge([t1])
    __setBridgeForTests(bridge)
    subscribeAgentEvents()
    await store().hydrate()
    await flush()
    const threadId = t1.threadId
    const turnId = 'trn_9' as TurnId
    bridge.emit({ type: 'turn.started', threadId, turnId, at: 1 })
    bridge.emit({ type: 'text.start', threadId, turnId, itemId: 'a' as never })
    bridge.emit({ type: 'text.delta', threadId, turnId, itemId: 'a' as never, delta: '好的' })
    expect(store().views.thr_1?.isStreaming).toBe(true)
    expect(store().views.thr_1?.items[0]).toEqual(expect.objectContaining({ kind: 'assistant', text: '好的' }))

    bridge.emit({ type: 'thread.title', threadId, title: '新标题' })
    expect(store().threads[0]?.title).toBe('新标题')

    // ≥ 80% usage → one warning toast with a compact action
    bridge.emit({ type: 'context.usage', threadId, usage: { usedTokens: 90, maxTokens: 100, breakdown: { system: 1, memory: 1, references: 1, history: 1, tools: 1 } } })
    bridge.emit({ type: 'context.usage', threadId, usage: { usedTokens: 92, maxTokens: 100, breakdown: { system: 1, memory: 1, references: 1, history: 1, tools: 1 } } })
    const warnings = getToasts().filter((t) => t.kind === 'warning')
    expect(warnings).toHaveLength(1)
    warnings[0]?.action?.onClick()
    await flush()
    expect(bridge.ops.at(-1)).toEqual({ type: 'thread.compact', threadId })

    // memory written → success toast
    bridge.emit({ type: 'memory.written', threadId, file: 'MEMORY', count: 2 })
    expect(getToasts().some((t) => t.kind === 'success' && t.text.includes('2 条记忆'))).toBe(true)

    // unread dot only while collapsed
    store().setCollapsed(true)
    bridge.emit({ type: 'turn.completed', threadId, turnId, finalText: '好的', usage: { inputTokens: 1, outputTokens: 1 }, steps: 1, at: 2 })
    expect(useShellStore.getState().agentUnread).toBe(true)
    store().setCollapsed(false)
    expect(useShellStore.getState().agentUnread).toBe(false)
    expect(store().views.thr_1?.isStreaming).toBe(false)
  })

  it('resolves approvals optimistically and submits the op', async () => {
    const bridge = fakeBridge([t1])
    __setBridgeForTests(bridge)
    subscribeAgentEvents()
    await store().hydrate()
    await flush()
    const threadId = t1.threadId
    const turnId = 'trn_2' as TurnId
    bridge.emit({ type: 'turn.started', threadId, turnId, at: 1 })
    bridge.emit({ type: 'approval.requested', threadId, turnId, approvalId: 'apr_1' as never, callId: 'cal_1' as never, toolName: 'send_message', summary: '发送', input: {}, risk: 'send', canAllowAlways: true })
    expect(store().views.thr_1?.pendingApprovals).toHaveLength(1)
    await store().resolveApproval(threadId, 'apr_1' as never, 'allow_once')
    expect(store().views.thr_1?.pendingApprovals).toHaveLength(0)
    expect(bridge.ops.at(-1)).toEqual({ type: 'approval.resolve', threadId, approvalId: 'apr_1', decision: 'allow_once' })
    // the kernel's own event is harmless afterwards
    bridge.emit({ type: 'approval.resolved', threadId, approvalId: 'apr_1' as never, decision: 'allow_once' })
    expect(store().views.thr_1?.pendingApprovals).toHaveLength(0)
  })

  it('tab operations: open / close / close others / remove', async () => {
    const bridge = fakeBridge([t1, t2])
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    store().openThread(t2.threadId)
    await flush()
    expect(store().openIds).toEqual(['thr_1', 'thr_2'])
    expect(store().activeThreadId).toBe('thr_2')
    store().closeThread(t2.threadId)
    expect(store().openIds).toEqual(['thr_1'])
    expect(store().activeThreadId).toBe('thr_1')
    store().openThread(t2.threadId)
    store().closeOtherThreads(t2.threadId)
    expect(store().openIds).toEqual(['thr_2'])
    await store().remove(t2.threadId)
    expect(store().threads.map((t) => t.threadId)).toEqual(['thr_1'])
    expect(store().openIds).toEqual([])
    expect(store().activeThreadId).toBeNull()
    expect(bridge.calls).toContain('agent:deleteThread')
  })

  it('updateSettings / rename / pin are optimistic and reach the bridge', async () => {
    const bridge = fakeBridge([t1])
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    await store().updateSettings(t1.threadId, { permissionMode: 'bypass' })
    expect(store().threads[0]?.settings.permissionMode).toBe('bypass')
    expect(bridge.ops.at(-1)).toEqual({ type: 'thread.settings', threadId: t1.threadId, patch: { permissionMode: 'bypass' } })
    await store().rename(t1.threadId, ' 新名字 ')
    expect(store().threads[0]?.title).toBe('新名字')
    await store().pin(t1.threadId, true)
    expect(store().threads[0]?.pinned).toBe(true)
    expect(bridge.calls).toEqual(expect.arrayContaining(['agent:renameThread', 'agent:pinThread']))
  })
})

describe('agentStore.sendDraft (composer submit)', () => {
  const s9 = { kind: 'session' as const, id: 's9', label: '投研交流群' }

  it('with no open thread: creates one bound to the active workspace tab, puts its chip before the scratch mentions and sends', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    useTabsStore.getState().open({ kind: 'chat', objectId: 's9', title: '投研交流群' })
    store().setDraft(SCRATCH_DRAFT_KEY, { text: ' 总结今天 ', mentions: [{ kind: 'memory', id: 'MEMORY', label: 'MEMORY.md' }] })
    await store().sendDraft()
    const id = store().activeThreadId
    expect(id).not.toBeNull()
    expect(store().openIds).toEqual([id])
    expect(store().threads[0]?.contextRef).toEqual(s9)
    expect(bridge.ops.map((o) => o.type)).toEqual(['thread.create', 'turn.start'])
    const turn = bridge.ops[1]
    if (turn?.type !== 'turn.start') throw new Error()
    expect(turn.input).toEqual({ content: [{ type: 'text', text: '总结今天' }], mentions: [s9, { kind: 'memory', id: 'MEMORY', label: 'MEMORY.md' }] })
    expect(turn.mode).toBe('start')
    expect(store().drafts[id!]).toEqual({ text: '', mentions: [] })
    expect(store().drafts[SCRATCH_DRAFT_KEY]).toEqual({ text: '', mentions: [] })
    expect(store().focusSeq).toBe(1)
  })

  it('does not duplicate the context chip when the scratch draft already references the same object', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    useTabsStore.getState().open({ kind: 'chat', objectId: 's9', title: '投研交流群' })
    store().setDraft(SCRATCH_DRAFT_KEY, { text: '总结', mentions: [{ ...s9, label: '投研交流群 · 3 条' }] })
    await store().sendDraft()
    const turn = bridge.ops.find((o) => o.type === 'turn.start')
    if (turn?.type !== 'turn.start') throw new Error()
    expect(turn.input.mentions).toEqual([s9])
  })

  it('with an open thread: sends that thread\'s draft and leaves the scratch slot alone', async () => {
    const bridge = fakeBridge([t1])
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    store().setDraft(SCRATCH_DRAFT_KEY, { text: '不该发出去' })
    store().setDraft(t1.threadId, { text: '你好' })
    await store().sendDraft()
    expect(bridge.ops.map((o) => o.type)).toEqual(['turn.start'])
    const turn = bridge.ops[0]
    if (turn?.type !== 'turn.start') throw new Error()
    expect(turn.threadId).toBe(t1.threadId)
    expect(turn.input.content).toEqual([{ type: 'text', text: '你好' }])
    expect(store().drafts[SCRATCH_DRAFT_KEY]?.text).toBe('不该发出去')
  })

  it('ignores an empty scratch draft without creating a thread', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    store().setDraft(SCRATCH_DRAFT_KEY, { text: '   ' })
    await store().sendDraft()
    expect(bridge.ops).toEqual([])
    expect(store().threads).toEqual([])
    expect(store().activeThreadId).toBeNull()
  })

  it('keeps the unsent draft in its tab when persistence fails', async () => {
    const bridge = fakeBridge()
    const failing: AiwcBridge = { ...bridge, invoke: ((channel: string, req: unknown) => (channel === 'agent:submit' ? Promise.reject(new Error('内核未就绪')) : bridge.invoke(channel as never, req as never))) as AiwcBridge['invoke'] }
    __setBridgeForTests(failing)
    store().setDraft(SCRATCH_DRAFT_KEY, { text: '总结今天' })
    await store().sendDraft()
    const id = store().activeThreadId!
    expect(store().localIds).toEqual([id])
    expect(store().drafts[id]).toEqual({ text: '总结今天', mentions: [] })
    expect(getToasts().some((t) => t.kind === 'error' && t.text.includes('发送失败'))).toBe(true)
  })
})

describe('agent panel recovery', () => {
  it('retries a failed history request', async () => {
    const bridge = fakeBridge([t1])
    let attempts = 0
    __setBridgeForTests({ ...bridge, invoke: (async (channel, req) => {
      if (channel === 'agent:listThreads' && attempts++ === 0) throw new Error('暂时离线')
      return bridge.invoke(channel, req as never)
    }) as AiwcBridge['invoke'] })
    await store().hydrate()
    expect(store().loadError).toBe('暂时离线')
    await store().hydrate()
    expect(attempts).toBe(2)
    expect(store().loadError).toBeUndefined()
    expect(store().threads).toEqual([t1])
    await flush()
  })

  it('keeps a new local tab when a slower history request finishes', async () => {
    const bridge = fakeBridge([t1])
    let finish!: (threads: ThreadSummary[]) => void
    __setBridgeForTests({ ...bridge, invoke: ((channel, req) => channel === 'agent:listThreads'
      ? new Promise((resolve) => { finish = resolve })
      : bridge.invoke(channel, req as never)) as AiwcBridge['invoke'] })
    const pending = store().hydrate()
    await flush()
    const id = await store().createThread()
    store().setDraft(id, { text: '还在写的草稿' })
    finish([t1])
    await pending
    expect(store().activeThreadId).toBe(id)
    expect(store().openIds).toEqual([id])
    expect(store().threads.map((t) => t.threadId)).toContain(t1.threadId)
    expect(store().drafts[id]?.text).toBe('还在写的草稿')
  })

  it('preserves both the failed message and text typed while sending', async () => {
    const bridge = fakeBridge([t1])
    let fail!: (reason: Error) => void
    __setBridgeForTests({ ...bridge, invoke: ((channel, req) => channel === 'agent:submit'
      ? new Promise((_, reject) => { fail = reject })
      : bridge.invoke(channel, req as never)) as AiwcBridge['invoke'] })
    await store().hydrate()
    await flush()
    store().setDraft(t1.threadId, { text: '第一条' })
    const pending = store().send(t1.threadId)
    await flush()
    store().setDraft(t1.threadId, { text: '接着输入的补充' })
    fail(new Error('连接断开'))
    await pending
    expect(store().drafts[t1.threadId]?.text).toBe('第一条\n\n接着输入的补充')
  })
})

describe('commands', () => {
  it('quote creates a thread when none is open, adds the chip and asks for focus', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    await store().quote({ kind: 'session', id: 's1', label: '产品市场群', messageIds: ['m1', 'm2'] })
    const id = store().activeThreadId
    expect(id).not.toBeNull()
    expect(store().drafts[id!]?.mentions).toEqual([{ kind: 'session', id: 's1', label: '产品市场群 · 2 条' }])
    expect(store().focusSeq).toBeGreaterThan(0)
    // a second quote reuses the active thread and de-duplicates
    await store().quote({ kind: 'session', id: 's1', label: '产品市场群' })
    expect(store().openIds).toHaveLength(1)
    expect(store().drafts[id!]?.mentions).toHaveLength(1)
  })

  it('newThread uses the active workspace tab as context', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    useTabsStore.getState().open({ kind: 'chat', objectId: 's9', title: '投研交流群' })
    const id = await store().newThread()
    expect(store().threads[0]?.contextRef).toEqual({ kind: 'session', id: 's9', label: '投研交流群' })
    expect(store().drafts[id]?.mentions[0]).toEqual({ kind: 'session', id: 's9', label: '投研交流群' })
  })
})

// keep the EventMap import used for type-checking the fake bridge listener signature
export type _Check = EventMap['agent:event']
