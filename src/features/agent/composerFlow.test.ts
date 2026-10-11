// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEW_THREAD_DRAFT_KEY,
  type AiwcBridge,
  type ComposerDraftRecord,
  type Event,
  type Op,
  type ThreadId,
  type ThreadSummary,
  type TurnId,
} from '@aiwc/protocol'
import { defaultConfig } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests } from '@/platform/configStore'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { __resetAgentStoreForTests, subscribeAgentEvents, useAgentStore } from './agentStore'
import { pastedTextAttachment } from './composer/attachments'
import {
  __resetDraftPersistenceForTests,
  DRAFT_SAVE_DELAY_MS,
  installDraftPersistence,
  newThreadDraft,
  persistedKey,
} from './draftPersistence'
import { mergeIntoDraft, takeQueuedInput, useQueueStore, __resetQueueForTests } from './queuedInputs'
import { SCRATCH_DRAFT_KEY } from './model'

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }
const thread: ThreadSummary = {
  threadId: 'thr_1' as ThreadId,
  title: 'T',
  origin: { channel: 'desktop' },
  settings,
  createdAt: 1,
  updatedAt: 10,
  pinned: false,
}

interface Fake extends AiwcBridge {
  ops: Op[]
  saved: Array<{ key: string; draft: ComposerDraftRecord | null }>
  emit(e: Event): void
}

function fake(
  opts: { threads?: ThreadSummary[]; drafts?: Array<{ key: string; draft: ComposerDraftRecord }> } = {},
): Fake {
  const listeners = new Set<(e: Event) => void>()
  const bridge: Fake = {
    runtime: 'web',
    platform: 'darwin',
    ops: [],
    saved: [],
    emit: (e) => listeners.forEach((l) => l(e)),
    on: ((channel: string, listener: (p: unknown) => void) => {
      if (channel === 'agent:event') listeners.add(listener as (e: Event) => void)
      return () => listeners.delete(listener as (e: Event) => void)
    }) as AiwcBridge['on'],
    invoke: (async (channel: string, req: unknown) => {
      switch (channel) {
        case 'config:get':
          return defaultConfig()
        case 'agent:listThreads':
          return opts.threads ?? []
        case 'agent:getThread': {
          const { threadId } = req as { threadId: ThreadId }
          return { summary: { ...thread, threadId }, items: [] }
        }
        case 'agent:submit':
          bridge.ops.push(req as Op)
          return undefined
        case 'agent:listModels':
        case 'agent:listSkills':
          return []
        case 'composer:loadDrafts':
          return (opts.drafts ?? []).map((d) => ({ ...d, updatedAt: 1 }))
        case 'composer:saveDraft':
          bridge.saved.push(req as { key: string; draft: ComposerDraftRecord | null })
          return undefined
        default:
          throw new Error(`unexpected ${channel}`)
      }
    }) as AiwcBridge['invoke'],
  }
  return bridge
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const store = () => useAgentStore.getState()
const turnStarts = (b: Fake) => b.ops.filter((o): o is Extract<Op, { type: 'turn.start' }> => o.type === 'turn.start')

beforeEach(() => {
  __resetAgentStoreForTests()
  __resetConfigStoreForTests()
  __resetShellStoreForTests()
  __resetQueueForTests()
})
afterEach(() => {
  __resetDraftPersistenceForTests()
  __setBridgeForTests(undefined)
  vi.useRealTimers()
})

describe('attachments in a send', () => {
  it('sends text first, then the attachment parts', async () => {
    const bridge = fake({ threads: [thread] })
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    const pasted = pastedTextAttachment('line\n'.repeat(100), 'paste.txt')
    store().setDraft(thread.threadId, { text: 'look', attachments: [pasted] })
    await store().send(thread.threadId)
    expect(turnStarts(bridge)[0]?.input.content).toEqual([{ type: 'text', text: 'look' }, pasted.part])
    expect(store().drafts[thread.threadId]?.attachments ?? []).toEqual([])
  })
})

describe('queued messages', () => {
  it('starts the next queued message when the turn completes, one per turn', async () => {
    const bridge = fake({ threads: [thread] })
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    subscribeAgentEvents()
    await flush()
    const turnId = 'trn_1' as TurnId
    bridge.emit({ type: 'turn.started', threadId: thread.threadId, turnId, at: 1 })
    useQueueStore.getState().enqueue(thread.threadId, { text: 'first', mentions: [] })
    useQueueStore.getState().enqueue(thread.threadId, { text: 'second', mentions: [] })
    expect(turnStarts(bridge)).toHaveLength(0)

    const usage = { inputTokens: 0, outputTokens: 0 }
    bridge.emit({ type: 'turn.completed', threadId: thread.threadId, turnId, finalText: '', usage, steps: 1, at: 2 })
    await flush()
    expect(turnStarts(bridge).map((o) => [o.input.content, o.mode])).toEqual([
      [[{ type: 'text', text: 'first' }], 'start'],
    ])
    expect(useQueueStore.getState().queues[thread.threadId]?.map((q) => q.draft.text)).toEqual(['second'])
  })

  it('holds the queue when a turn stops early', async () => {
    const bridge = fake({ threads: [thread] })
    __setBridgeForTests(bridge)
    await store().hydrate()
    await flush()
    subscribeAgentEvents()
    await flush()
    const turnId = 'trn_1' as TurnId
    bridge.emit({ type: 'turn.started', threadId: thread.threadId, turnId, at: 1 })
    useQueueStore.getState().enqueue(thread.threadId, { text: 'later', mentions: [] })
    bridge.emit({ type: 'turn.aborted', threadId: thread.threadId, turnId, reason: 'interrupted' })
    await flush()
    expect(turnStarts(bridge)).toHaveLength(0)
    expect(useQueueStore.getState().held[thread.threadId]).toBe(true)
    // the next completed turn releases it
    expect(takeQueuedInput(thread.threadId, true)?.text).toBe('later')
    expect(useQueueStore.getState().held[thread.threadId]).toBeUndefined()
  })

  it('merges a queued message back into the draft for editing', () => {
    const merged = mergeIntoDraft(
      { text: 'draft', mentions: [{ kind: 'session', id: 'a', label: 'A' }] },
      { text: 'queued', mentions: [{ kind: 'session', id: 'a', label: 'A' }] },
    )
    expect(merged).toEqual({
      text: 'draft\n\nqueued',
      mentions: [{ kind: 'session', id: 'a', label: 'A' }],
      attachments: [],
    })
  })
})

describe('draft persistence', () => {
  it('maps the scratch slot and unsent threads to the new-conversation key', () => {
    expect(persistedKey(SCRATCH_DRAFT_KEY, [])).toBe(NEW_THREAD_DRAFT_KEY)
    expect(persistedKey('thr_local', ['thr_local'])).toBe(NEW_THREAD_DRAFT_KEY)
    expect(persistedKey('thr_1', ['thr_local'])).toBe('thr_1')
    const drafts = { [SCRATCH_DRAFT_KEY]: { text: 'keep', mentions: [] }, thr_local: { text: '', mentions: [] } }
    expect(newThreadDraft(drafts, ['thr_local'], 'thr_local')?.text).toBe('keep')
  })

  it('restores saved drafts into empty slots and saves edits after a pause', async () => {
    const bridge = fake({
      threads: [thread],
      drafts: [{ key: 'thr_1', draft: { text: 'from last time', mentions: [], attachments: [] } }],
    })
    __setBridgeForTests(bridge)
    await store().hydrate()
    installDraftPersistence()
    await flush()
    await flush()
    expect(store().drafts[thread.threadId]?.text).toBe('from last time')

    vi.useFakeTimers()
    store().setDraft(thread.threadId, { text: 'edited' })
    store().setDraft(thread.threadId, { text: 'edited again' })
    expect(bridge.saved).toEqual([])
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
    expect(bridge.saved).toEqual([{ key: 'thr_1', draft: { text: 'edited again', mentions: [], attachments: [] } }])
    store().setDraft(thread.threadId, { text: '' })
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
    expect(bridge.saved.at(-1)).toEqual({ key: 'thr_1', draft: null })
  })

  it('reopens an unsent new conversation as a tab', async () => {
    const bridge = fake({
      threads: [thread],
      drafts: [{ key: NEW_THREAD_DRAFT_KEY, draft: { text: 'half-written', mentions: [], attachments: [] } }],
    })
    __setBridgeForTests(bridge)
    installDraftPersistence()
    await store().hydrate()
    for (let i = 0; i < 5; i++) await flush()
    const active = store().activeThreadId
    expect(active && store().localIds.includes(active)).toBe(true)
    expect(active ? store().drafts[active]?.text : undefined).toBe('half-written')
  })
})
