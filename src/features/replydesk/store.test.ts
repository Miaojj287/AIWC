import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiwcBridge, EventMap, ReplyDraft } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetReplyDeskForTests, startReplyDesk, useReplyDeskStore } from './store'
import { pendingCount } from './reducer'

type Listener = (payload: unknown) => void

const draft = (id: string, patch: Partial<ReplyDraft> = {}): ReplyDraft => ({
  id,
  source: { channel: 'wechat-ui', peerId: 'p', chatId: 'c', chatType: 'dm' },
  triggerMessageId: 'm',
  triggerText: 't',
  draft: 'd',
  state: 'pending',
  createdAt: 1,
  mode: 'confirm',
  ...patch,
})

function fakeBridge(initial: ReplyDraft[]) {
  const listeners = new Map<string, Set<Listener>>()
  const bridge: AiwcBridge & { emit<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void } = {
    runtime: 'web',
    platform: 'darwin',
    emit(channel, payload) {
      for (const l of listeners.get(channel) ?? []) l(payload)
    },
    on: ((channel: string, listener: Listener) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
      return () => set.delete(listener)
    }) as AiwcBridge['on'],
    invoke: (async (channel: string) => {
      if (channel === 'autoreply:listDrafts') return initial
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
  return bridge
}

describe('reply desk store', () => {
  let stop: (() => void) | undefined
  beforeEach(() => __resetReplyDeskForTests())
  afterEach(() => {
    stop?.()
    __setBridgeForTests(undefined)
  })

  it('loads pending drafts on start and follows pushes', async () => {
    const bridge = fakeBridge([draft('a')])
    __setBridgeForTests(bridge)
    stop = await startReplyDesk()
    await new Promise((r) => setTimeout(r, 0))
    expect(pendingCount(useReplyDeskStore.getState().state)).toBe(1)

    bridge.emit('autoreply:draft', draft('b', { mode: 'auto', countdownEndsAt: 10_000 }))
    bridge.emit('gateway:event', { type: 'autoreply.countdown', draftId: 'b', remainingMs: 2500 })
    let s = useReplyDeskStore.getState().state
    expect(pendingCount(s)).toBe(2)
    expect(s.countdowns.b).toBe(2500)

    bridge.emit('gateway:event', { type: 'autoreply.halted', reason: 'DB 读回校验失败' })
    s = useReplyDeskStore.getState().state
    expect(s.halted).toBe('DB 读回校验失败')

    bridge.emit('autoreply:draft', draft('a', { state: 'sent' }))
    expect(pendingCount(useReplyDeskStore.getState().state)).toBe(1)
  })

  it('is idempotent and reports load failures', async () => {
    const bridge = fakeBridge([])
    bridge.invoke = (async () => {
      throw new Error('offline')
    }) as AiwcBridge['invoke']
    __setBridgeForTests(bridge)
    const first = startReplyDesk()
    const second = startReplyDesk()
    expect(first).toBe(second)
    stop = await first
    await new Promise((r) => setTimeout(r, 0))
    const s = useReplyDeskStore.getState().state
    expect(s.loaded).toBe(true)
    expect(s.error).toBe('offline')
  })
})
