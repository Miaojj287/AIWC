import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventChannel, ModelEntry, ToastPayload } from '@aiwc/protocol'
import { AppConfigSchema } from '@aiwc/protocol'
import { createMemoryStore, memoryTools } from '@aiwc/memory'
import { describe, expect, it } from 'vitest'
import { composeMemoryReview } from './composeMemory'
import { lowestEffortSettings } from './ai/lowEffortModel'
import { registerMemoryReviewIpc } from './ipc/memoryReview'
import { createHandlerHarness } from './ipc/testing/handlerHarness'
import type { HostBridge } from './ipc/register'
import { nullLogger } from './log'

function setup(memoryConfig: { confirmBeforeWrite?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-review-'))
  const memory = createMemoryStore({ dir })
  const config = AppConfigSchema.parse({ memory: memoryConfig })
  const toasts: ToastPayload[] = []
  const pushes: Array<[EventChannel, unknown]> = []
  const review = composeMemoryReview({
    dir,
    memory,
    config: () => config,
    broadcast: (channel, payload) => pushes.push([channel, payload]),
    toast: (p) => toasts.push(p),
    logger: nullLogger,
  })
  const ipc = createHandlerHarness()
  registerMemoryReviewIpc({ memoryReview: review }, {} as HostBridge, ipc.handle)
  return { memory, review, toasts, pushes, ipc }
}

describe('composeMemoryReview', () => {
  it('toasts "memory written" only for writes that actually happened from the Agent', async () => {
    const { memory, toasts } = setup()
    await memory.addEntry('MEMORY', '用户的事实', { source: 'agent' })
    await memory.write('USER', '用户自己写的', { source: 'user' })
    expect(toasts.map((t) => t.id)).toEqual(['memory.written'])
  })

  it('routes remember into the review list when 写入前需要确认 is on, and pushes the list', async () => {
    const { memory, review, toasts, pushes, ipc } = setup({ confirmBeforeWrite: true })
    const remember = memoryTools(review.toolOptions).find((t) => t.name === 'remember')
    await remember?.execute({ file: 'USER', text: '用户喜欢猫' }, {
      threadId: 'thr_x',
      turnId: 'trn_x',
      stepId: 'stp_x',
      callId: 'cal_x',
      channel: 'desktop',
      profile: 'desktop-chat',
      signal: new AbortController().signal,
      services: { memory },
      progress: () => {},
      depth: 0,
    } as never)
    expect(await memory.entries('USER')).toEqual([])
    expect(toasts.map((t) => [t.id, t.action?.payload])).toEqual([
      ['memory.review', { page: 'memory', highlight: 'memory.review' }],
    ])
    expect(pushes.map(([c]) => c)).toEqual(['memoryReview:changed'])

    const [proposal] = await ipc.invoke('memoryReview:list', undefined)
    if (!proposal) throw new Error('no proposal')
    expect(await ipc.invoke('memoryReview:accept', { id: proposal.id })).toEqual({ ok: true })
    expect((await memory.entries('USER')).map((e) => e.text)).toEqual(['用户喜欢猫'])
    // Accepting is the user's write: no "Agent wrote memory" toast.
    expect(toasts.filter((t) => t.id === 'memory.written')).toEqual([])
  })

  it('validates renderer input before touching anything', async () => {
    const { ipc } = setup()
    expect(() => ipc.invokeRaw('memoryReview:accept', { id: 'x', text: '' })).toThrow()
    expect(() => ipc.invokeRaw('memoryReview:accept', { id: 'x', file: 'SOUL' })).toThrow()
    expect(() => ipc.invokeRaw('memoryReview:dismiss', { ids: [] })).toThrow()
    expect(() => ipc.invokeRaw('memoryReview:dismiss', { ids: 'mp_1' })).toThrow()
    expect(await ipc.invoke('memoryReview:accept', { id: 'mp_missing' })).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('lowestEffortSettings', () => {
  const entry = (modelId: string, extra: Partial<ModelEntry> = {}): ModelEntry =>
    ({ modelId, label: modelId, contextWindow: 128_000, ...extra }) as ModelEntry

  it('turns reasoning down to the lowest level the model supports and drops fast mode', () => {
    expect(
      lowestEffortSettings({ kind: 'openai' }, entry('gpt-5.4', { reasoningEffort: 'high' })).reasoningEffort,
    ).toBe('off')
    expect(lowestEffortSettings({ kind: 'openai' }, entry('gpt-5-mini')).reasoningEffort).toBe('minimal')
    const opus = lowestEffortSettings({ kind: 'anthropic' }, entry('claude-opus-5', { fast: true }))
    expect([opus.reasoningEffort, opus.fast]).toEqual(['low', false])
    expect(
      lowestEffortSettings({ kind: 'anthropic' }, entry('claude-sonnet-4-5', { thinkingBudget: 8000 })).thinkingBudget,
    ).toBe(undefined)
  })
})
