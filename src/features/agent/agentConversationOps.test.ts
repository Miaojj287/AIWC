// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultConfig,
  type AiwcBridge,
  type HistoryItem,
  type Op,
  type ThreadId,
  type ThreadSummary,
  type TurnId,
} from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests } from '@/platform/configStore'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { clearToasts, getToasts } from '@/kit'
import { __resetAgentStoreForTests, useAgentStore } from './agentStore'
import { readSavedTabs, writeSavedTabs } from './threadRestore'

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }
const summary = (id: string, updatedAt: number, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: id as ThreadId,
  title: id,
  origin: { channel: 'desktop' },
  settings,
  createdAt: 1,
  updatedAt,
  pinned: false,
  ...extra,
})
const user = (id: string, turn: string, text: string): HistoryItem => ({
  type: 'user_message',
  id: id as never,
  turnId: turn as TurnId,
  createdAt: 1,
  content: [{ type: 'text', text }],
  mentions: [],
})
const reply = (id: string, turn: string): HistoryItem => ({
  type: 'assistant_message',
  id: id as never,
  turnId: turn as TurnId,
  stepId: 'stp_1' as never,
  createdAt: 2,
  text: `答复 ${id}`,
})

interface Fake extends AiwcBridge {
  ops: Op[]
  calls: Array<{ channel: string; req: unknown }>
  failRollback: boolean
}

function fakeBridge(threads: ThreadSummary[], history: Record<string, HistoryItem[]> = {}): Fake {
  const bridge: Fake = {
    runtime: 'web',
    platform: 'darwin',
    ops: [],
    calls: [],
    failRollback: false,
    on: (() => () => undefined) as AiwcBridge['on'],
    invoke: (async (channel: string, req: unknown) => {
      bridge.calls.push({ channel, req })
      switch (channel) {
        case 'config:get':
          return defaultConfig()
        case 'agent:listThreads':
          return threads
        case 'agent:getThread': {
          const { threadId } = req as { threadId: ThreadId }
          const found = threads.find((t) => t.threadId === threadId)
          if (!found) throw new Error('会话不存在或已被删除')
          return { summary: found, items: history[threadId] ?? [] }
        }
        case 'agent:submit': {
          const op = req as Op
          if (op.type === 'thread.rollback' && bridge.failRollback) throw new Error('refused')
          bridge.ops.push(op)
          return undefined
        }
        case 'agent:archiveThread':
          return undefined
        case 'agent:listArchivedThreads':
          return [summary('thr_old', 1, { archived: true })]
        case 'agent:forkThread':
          return summary('thr_fork', 99, { title: (req as { title: string }).title })
        case 'agent:listModels':
        case 'agent:listSkills':
          return []
        default:
          throw new Error(`unexpected ${channel}`)
      }
    }) as AiwcBridge['invoke'],
  }
  return bridge
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const store = () => useAgentStore.getState()
const history = { thr_1: [user('u1', 't1', '一'), reply('a1', 't1'), user('u2', 't2', '二'), reply('a2', 't2')] }

beforeEach(() => {
  __resetAgentStoreForTests()
  __resetConfigStoreForTests()
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
  clearToasts()
})
afterEach(() => __setBridgeForTests(undefined))

async function hydrated(threads: ThreadSummary[]) {
  const bridge = fakeBridge(threads, history)
  __setBridgeForTests(bridge)
  await store().hydrate()
  await flush()
  return bridge
}

describe('rewindTurn (编辑 / 重新生成)', () => {
  it('rolls the kernel back to the prompt, then runs the new input as the next turn', async () => {
    const bridge = await hydrated([summary('thr_1', 10)])
    const id = 'thr_1' as ThreadId
    const input = { content: [{ type: 'text' as const, text: '二（改）' }], mentions: [] }
    expect(await store().rewindTurn(id, 'u2', input)).toBe(true)
    expect(bridge.ops.map((o) => o.type)).toEqual(['thread.rollback', 'turn.start'])
    expect(bridge.ops[0]).toMatchObject({ type: 'thread.rollback', turns: 1, fromItemId: 'u2' })
    expect(bridge.ops[1]).toMatchObject({ type: 'turn.start', mode: 'start', input })
    expect(store().views[id]!.items.map((it) => it.id)).toEqual(['u1', 'a1'])
    expect(store().views[id]!.pendingInputs?.[0]?.content).toEqual(input.content)
  })

  it('keeps the transcript and says so when the kernel refuses', async () => {
    const bridge = await hydrated([summary('thr_1', 10)])
    bridge.failRollback = true
    const id = 'thr_1' as ThreadId
    const input = { content: [{ type: 'text' as const, text: 'x' }], mentions: [] }
    expect(await store().rewindTurn(id, 'u1', input)).toBe(false)
    expect(store().views[id]!.items.map((it) => it.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(bridge.ops).toEqual([])
    expect(getToasts().some((t) => t.kind === 'error')).toBe(true)
  })
})

describe('rewindTurn while a send is in flight', () => {
  it('refuses to roll back while a sent prompt is not recorded yet or a turn runs', async () => {
    const bridge = await hydrated([summary('thr_1', 10)])
    const id = 'thr_1' as ThreadId
    store().setDraft(id, { text: '刚发出的' })
    await store().send(id)
    expect(store().views[id]!.pendingInputs).toHaveLength(1)
    const input = { content: [{ type: 'text' as const, text: 'x' }], mentions: [] }
    expect(await store().rewindTurn(id, 'u2', input)).toBe(false)
    expect(bridge.ops.map((o) => o.type)).toEqual(['turn.start'])
    expect(store().views[id]!.pendingInputs).toHaveLength(1)
    expect(getToasts().some((t) => t.kind === 'info')).toBe(true)
  })
})

describe('archive and fork', () => {
  it('archiving moves a thread out of the list and its tab; undo brings it back', async () => {
    const bridge = await hydrated([summary('thr_1', 10), summary('thr_2', 5)])
    await store().archive('thr_1' as ThreadId, true)
    expect(bridge.calls.some((c) => c.channel === 'agent:archiveThread')).toBe(true)
    expect(store().threads.map((t) => t.threadId)).toEqual(['thr_2'])
    expect(store().openIds).not.toContain('thr_1')
    expect(store().archived[0]).toMatchObject({ threadId: 'thr_1', archived: true })
    await store().archive('thr_1' as ThreadId, false)
    expect(store().threads.map((t) => t.threadId)).toEqual(['thr_1', 'thr_2'])
    expect(store().archived).toEqual([])
    await store().loadArchived()
    expect(store().archived.map((t) => t.threadId)).toEqual(['thr_old'])
  })

  it('forking opens the new thread in front', async () => {
    const bridge = await hydrated([summary('thr_1', 10)])
    await store().forkFromTurn('thr_1' as ThreadId, 'u1')
    expect(bridge.calls.find((c) => c.channel === 'agent:forkThread')?.req).toMatchObject({
      threadId: 'thr_1',
      throughItemId: 'u1',
    })
    expect(store().activeThreadId).toBe('thr_fork')
    expect(store().openIds).toContain('thr_fork')
    expect(store().threads[0]?.threadId).toBe('thr_fork')
  })
})

describe('quoteText and restored tabs', () => {
  it('quotes a selection into the active composer with its source as a chip', async () => {
    await hydrated([summary('thr_1', 10)])
    await store().quoteText({ text: '第一行\n第二行', source: { kind: 'session', id: 's1', label: '项目群' } })
    const draft = store().drafts['thr_1']!
    expect(draft.text).toBe('> 第一行\n> 第二行\n\n')
    expect(draft.mentions).toEqual([{ kind: 'session', id: 's1', label: '项目群' }])
  })

  it('reopens the tabs saved at the last quit and drops the ones that no longer exist', async () => {
    writeSavedTabs({
      openIds: ['thr_2', 'thr_gone', 'thr_1'] as ThreadId[],
      activeThreadId: 'thr_2' as ThreadId,
    })
    await hydrated([summary('thr_1', 10), summary('thr_2', 5)])
    await flush()
    expect(store().openIds).toEqual(['thr_2', 'thr_1'])
    expect(store().activeThreadId).toBe('thr_2')
    store().setActive('thr_1' as ThreadId)
    expect(readSavedTabs()).toEqual({ openIds: ['thr_2', 'thr_1'], activeThreadId: 'thr_1' })
  })

  it('a new thread carries its context chip into thread.create', async () => {
    const bridge = await hydrated([])
    const ref = { kind: 'file' as const, id: '/notes/a.md', label: 'a.md' }
    const id = await store().newThread({ contextRef: ref })
    await store().send(id, { text: '概括', mentions: [] })
    const create = bridge.ops.find((o) => o.type === 'thread.create')
    expect(create).toMatchObject({ origin: { channel: 'desktop', contextRef: ref } })
  })
})
