import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Event, HistoryItem, ModelClient, ThreadSettings, ThreadOrigin } from '@aiwc/protocol'
import { asThreadId, asTurnId, newItemId, newStepId, newTurnId } from '@aiwc/protocol'
import { createMemoryProposalStore, createMemoryStore } from '@aiwc/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryExtractor } from './memoryExtraction'

const IDLE = 1000

const user = (text: string): HistoryItem => ({
  type: 'user_message',
  id: newItemId(),
  turnId: newTurnId(),
  createdAt: 1,
  content: [{ type: 'text', text }],
  mentions: [],
})
const agent = (text: string): HistoryItem => ({
  type: 'assistant_message',
  id: newItemId(),
  turnId: newTurnId(),
  stepId: newStepId(),
  createdAt: 2,
  text,
})

interface FakeThread {
  origin: ThreadOrigin
  settings: ThreadSettings
  items: HistoryItem[]
  running?: boolean
}

function setup(threads: Record<string, FakeThread>, opts: { enabled?: () => boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-extract-'))
  const listeners = new Set<(e: Event) => void>()
  const kernel = {
    events: {
      on: (l: (e: Event) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    },
    getThread: async (id: string) => {
      const t = threads[id]
      if (!t) return undefined
      return {
        record: {
          threadId: asThreadId(id),
          origin: t.origin,
          settings: t.settings,
          title: '周末计划',
          createdAt: 0,
          updatedAt: 0,
          pinned: false,
          archived: false,
          itemCount: t.items.length,
        },
        items: t.items,
        running: t.running ?? false,
      }
    },
    listThreads: async () => [],
  }
  const proposals = createMemoryProposalStore({ dir })
  const memory = createMemoryStore({ dir })
  const extract = vi.fn(async () => [{ file: 'USER' as const, text: '用户周末喜欢爬山' }])
  const models: Array<ThreadSettings['model']> = []
  const extractor = createMemoryExtractor({
    kernel,
    proposals,
    memory,
    enabled: opts.enabled ?? (() => true),
    model: async (selection) => {
      models.push(selection)
      return {} as ModelClient
    },
    extract,
    idleMs: IDLE,
    logger: () => {},
  })
  const emit = (e: Event) => listeners.forEach((l) => l(e))
  const completed = (threadId: string) =>
    emit({
      type: 'turn.completed',
      threadId: asThreadId(threadId),
      turnId: asTurnId('trn_x'),
      finalText: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 1,
      at: 0,
    })
  return { extractor, proposals, extract, models, emit, completed }
}

const desktop: Pick<FakeThread, 'origin' | 'settings'> = {
  origin: { channel: 'desktop' },
  settings: {
    permissionMode: 'ask',
    profile: 'desktop-chat',
    allowAlways: [],
    model: { providerId: 'local', modelId: 'qwen' },
  },
}

describe('createMemoryExtractor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('distils a desktop thread after it has been idle, with its own model, once per new message', async () => {
    const thread: FakeThread = { ...desktop, items: [user('我周末一般都去爬山，帮我看看天气'), agent('好的')] }
    const { proposals, extract, models, completed, emit } = setup({ thr_a: thread })

    completed('thr_a')
    await vi.advanceTimersByTimeAsync(IDLE / 2)
    // A new turn before the idle window ends resets it.
    emit({ type: 'turn.started', threadId: asThreadId('thr_a'), turnId: asTurnId('trn_y'), at: 0 })
    await vi.advanceTimersByTimeAsync(IDLE)
    expect(extract).not.toHaveBeenCalled()

    completed('thr_a')
    await vi.advanceTimersByTimeAsync(IDLE)
    await vi.waitFor(() => expect(proposals.list()).toHaveLength(1))
    expect(proposals.list()[0]).toMatchObject({ origin: 'extraction', threadId: 'thr_a', threadTitle: '周末计划' })
    expect(models).toEqual([{ providerId: 'local', modelId: 'qwen' }])
    expect(proposals.extractedCount('thr_a')).toBe(1)

    // Nothing new since the watermark: no second call.
    completed('thr_a')
    await vi.advanceTimersByTimeAsync(IDLE)
    expect(extract).toHaveBeenCalledTimes(1)
  })

  it('leaves persona / bot threads, tiny follow-ups and a switched-off setting alone', async () => {
    let enabled = true
    const { extractor, extract } = setup(
      {
        persona: {
          ...desktop,
          settings: { ...desktop.settings, profile: 'persona' },
          items: [user('我叫阿明，记住我')],
        },
        bot: { ...desktop, origin: { channel: 'wechat-ilink', chatId: 'c' }, items: [user('我叫阿明，记住我')] },
        tiny: { ...desktop, items: [user('好的')] },
        normal: { ...desktop, items: [user('以后叫我阿明就行，别叫全名')] },
      },
      { enabled: () => enabled },
    )
    expect(await extractor.run('persona')).toBe(0)
    expect(await extractor.run('bot')).toBe(0)
    expect(await extractor.run('tiny')).toBe(0)
    enabled = false
    expect(await extractor.run('normal')).toBe(0)
    expect(extract).not.toHaveBeenCalled()
    enabled = true
    expect(await extractor.run('normal')).toBe(1)
  })

  it('keeps the watermark when the model call fails, so the next idle retries', async () => {
    const { extractor, extract, proposals } = setup({
      thr_f: { ...desktop, items: [user('我对花生过敏，点餐时注意')] },
    })
    extract.mockRejectedValueOnce(new Error('network'))
    await expect(extractor.run('thr_f')).rejects.toThrow('network')
    expect(proposals.extractedCount('thr_f')).toBe(0)
    expect(await extractor.run('thr_f')).toBe(1)
  })

  it('dispose cancels pending idle timers', async () => {
    const { extractor, extract, completed } = setup({
      thr_d: { ...desktop, items: [user('我在杭州工作，住在西湖区')] },
    })
    completed('thr_d')
    extractor.dispose()
    await vi.advanceTimersByTimeAsync(IDLE * 2)
    expect(extract).not.toHaveBeenCalled()
  })
})
