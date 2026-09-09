import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule, SubstrateService, WxMessage } from '@aiwc/protocol'
import { createAutoReplyMonitor } from './autoReplyMonitor'

const rule: AutoReplyRule = { id: 'r', sessionId: 'alice', enabled: true, source: 'fixed', fixedText: '收到', historyCount: 30, updatedAt: 0 }

/** `mine` starts the chat with our own message as the last one, i.e. nothing to catch up on. */
function setup({ mine = false }: { mine?: boolean } = {}) {
  let owner = 'owner'
  let rules: AutoReplyRule[] = [rule]
  let message = {
    id: 'old', seq: 1, createdAt: Date.now(), sessionId: 'alice',
    senderId: mine ? 'owner' : 'alice', isSelf: mine, kind: 'text', text: mine ? '我说的' : '旧消息',
  } as WxMessage
  const substrate = {
    status: () => ({ connection: 'ready', account: { wxid: owner }, sync: { phase: 'idle' } }),
    getSession: async () => ({ id: 'alice', title: 'Alice', kind: 'dm', unread: 0 }),
    listMessages: async () => ({ items: [message] }),
    subscribe: () => () => {},
  } as unknown as SubstrateService
  const ingest = vi.fn(async () => {})
  const invalidate = vi.fn()
  const accountChanged = vi.fn()
  const monitor = createAutoReplyMonitor({ substrate, rules: () => rules, ingest, invalidate, accountChanged, quietMs: 5000, pollMs: 100000 })
  return {
    monitor, ingest, invalidate, accountChanged,
    setOwner: (value: string) => { owner = value },
    disable: () => { rules = [{ ...rule, enabled: false }] },
    remove: () => { rules = [] },
    message: (patch: Partial<WxMessage>) => { message = { ...message, ...patch } },
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000) })
afterEach(() => vi.useRealTimers())
const start = async (h: ReturnType<typeof setup>) => { h.monitor.start(); await vi.advanceTimersByTimeAsync(0) }

describe('local WeChat auto-reply monitor', () => {
  it('catches up on enable: an unanswered message is replied to without waiting for a new one', async () => {
    const h = setup()
    await start(h)
    expect(h.ingest).not.toHaveBeenCalled() // still inside the quiet window
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(h.ingest.mock.calls[0]?.[0]).toMatchObject({ text: '旧消息', source: { chatId: 'alice' } })
    h.monitor.stop()
  })

  it('answers an unanswered message however old it is — that is the point of the catch-up', async () => {
    const h = setup()
    h.message({ createdAt: Date.now() - 30 * 24 * 60 * 60_000 })
    await start(h)
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.ingest).toHaveBeenCalledTimes(1)
    h.monitor.stop()
  })

  it('stays quiet when we already had the last word, and does not re-fire on later refreshes', async () => {
    const h = setup({ mine: true })
    await start(h)
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.ingest).not.toHaveBeenCalled()
    await h.monitor.refresh()
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.ingest).not.toHaveBeenCalled()
    h.monitor.stop()
  })

  it('does not repeat the catch-up while the same message is still the last one', async () => {
    const h = setup()
    await start(h)
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.ingest).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) {
      await h.monitor.refresh()
      await vi.advanceTimersByTimeAsync(6000)
    }
    expect(h.ingest).toHaveBeenCalledTimes(1)
    h.monitor.stop()
  })

  it('combines a burst of new messages into one reply to the latest, even when unread is zero', async () => {
    const h = setup({ mine: true })
    await start(h)
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.ingest).not.toHaveBeenCalled()
    h.message({ id: 'new1', seq: 2, isSelf: false, senderId: 'alice', text: '你在吗' }); await h.monitor.refresh()
    await vi.advanceTimersByTimeAsync(3000)
    h.message({ id: 'new2', seq: 3, text: '明天见' }); await h.monitor.refresh()
    await vi.advanceTimersByTimeAsync(4999); expect(h.ingest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(h.ingest.mock.calls[0]?.[0]).toMatchObject({ text: '明天见', source: { channel: 'wechat-ui', chatId: 'alice' }, raw: { accountId: 'owner' } })
    h.monitor.stop()
  })

  it('ignores a newly arrived message that is already stale (clock jump / bulk re-index)', async () => {
    const h = setup({ mine: true })
    await start(h)
    await vi.advanceTimersByTimeAsync(6000)
    h.message({ id: 'new', seq: 2, isSelf: false, senderId: 'alice', text: '很久以前', createdAt: Date.now() - 20 * 60_000 })
    await h.monitor.refresh()
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.ingest).not.toHaveBeenCalled()
    h.monitor.stop()
  })

  describe('triggerNow', () => {
    it('replies to the last message immediately, skipping the quiet window and the seen-latch', async () => {
      const h = setup()
      await start(h)
      await vi.advanceTimersByTimeAsync(6000)
      expect(h.ingest).toHaveBeenCalledTimes(1)

      await expect(h.monitor.triggerNow('alice')).resolves.toEqual({ triggered: true })
      expect(h.ingest).toHaveBeenCalledTimes(2)
      expect(h.ingest.mock.calls[1]?.[1]).toEqual({ force: true })
      expect(h.ingest.mock.calls[1]?.[0]).toMatchObject({ text: '旧消息', source: { chatId: 'alice' } })
      h.monitor.stop()
    })

    it('refuses with a reason instead of doing nothing silently', async () => {
      const h = setup({ mine: true })
      await start(h)
      await expect(h.monitor.triggerNow('alice')).resolves.toEqual({ triggered: false, reason: '最后一条是你发的，没有待回复的消息' })
      h.disable()
      await expect(h.monitor.triggerNow('alice')).resolves.toEqual({ triggered: false, reason: '这个会话的自动回复没有开启' })
      expect(h.ingest).not.toHaveBeenCalled()
      h.monitor.stop()
    })

    it('does not leave the poll double-firing for the message it just triggered', async () => {
      const h = setup()
      h.monitor.start()
      await h.monitor.triggerNow('alice')
      expect(h.ingest).toHaveBeenCalledTimes(1)
      await h.monitor.refresh()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(h.ingest).toHaveBeenCalledTimes(1)
      h.monitor.stop()
    })
  })

  it.each(['self', 'disabled', 'removed', 'account', 'stop'])('cancels a pending reply on %s', async (action) => {
    const h = setup({ mine: true })
    await start(h)
    h.message({ id: 'new', seq: 2, isSelf: false, senderId: 'alice' }); await h.monitor.refresh()
    if (action === 'self') h.message({ id: 'mine', seq: 3, isSelf: true })
    if (action === 'disabled') h.disable()
    if (action === 'removed') h.remove()
    if (action === 'account') h.setOwner('other')
    if (action === 'stop') h.monitor.stop()
    else await h.monitor.refresh()
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.ingest).not.toHaveBeenCalled()
    if (action === 'account') expect(h.accountChanged).toHaveBeenCalledTimes(1)
    h.monitor.stop()
  })
})
