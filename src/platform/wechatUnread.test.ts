// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubstrateEvent, WxSession } from '@aiwc/protocol'
import { __resetWechatUnreadForTests, countsTowardUnread, summarizeUnread, useWechatUnread } from './wechatUnread'

const { invokeMock, listeners } = vi.hoisted(() => ({
  invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>(),
  listeners: new Set<(event: SubstrateEvent) => void>(),
}))
vi.mock('./hooks', () => ({ invoke: invokeMock }))
vi.mock('./bridge', () => ({
  getBridge: async () => ({
    on: (_channel: string, listener: (event: SubstrateEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }),
}))

const session = (id: string, unread: number, patch: Partial<WxSession> = {}): WxSession => ({
  id,
  kind: id.endsWith('@chatroom') ? 'group' : 'dm',
  title: id,
  unread,
  pinned: false,
  muted: false,
  ...patch,
})

describe('WeChat unread summary', () => {
  it("counts like WeChat's own badge: muted, folded and official chats do not add to it", () => {
    expect(countsTowardUnread(session('wxid_a', 3))).toBe(true)
    expect(countsTowardUnread(session('room@chatroom', 2))).toBe(true)
    expect(countsTowardUnread(session('wxid_b', 0))).toBe(false)
    expect(countsTowardUnread(session('wxid_c', 4, { muted: true }))).toBe(false)
    expect(countsTowardUnread(session('room2@chatroom', 9, { collapsed: true }))).toBe(false)
    expect(countsTowardUnread(session('gh_news', 7))).toBe(false)
    expect(countsTowardUnread(session('notify', 1, { kind: 'official' }))).toBe(false)
    expect(countsTowardUnread(session('sys', 1, { kind: 'system' }))).toBe(false)
  })

  it('sums messages and chats, and flags a partial scan', () => {
    const sessions = [
      session('wxid_a', 3),
      session('room@chatroom', 2),
      session('wxid_c', 4, { muted: true }),
      session('gh_news', 7),
    ]
    expect(summarizeUnread(sessions, false)).toEqual({ messages: 5, chats: 2, capped: false })
    expect(summarizeUnread(sessions, true).capped).toBe(true)
    expect(summarizeUnread([], false)).toEqual({ messages: 0, chats: 0, capped: false })
  })
})

describe('useWechatUnread', () => {
  let page: WxSession[]
  beforeEach(() => {
    vi.useFakeTimers()
    page = [session('wxid_a', 3)]
    invokeMock.mockReset()
    invokeMock.mockImplementation(async () => ({ items: page, total: page.length, hasMore: false }))
  })
  afterEach(() => {
    cleanup()
    __resetWechatUnreadForTests()
    listeners.clear()
    vi.useRealTimers()
  })

  it('shares one request between readers and refreshes once a burst of changes settles', async () => {
    const a = renderHook(() => useWechatUnread())
    const b = renderHook(() => useWechatUnread())
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('substrate:listSessions', expect.objectContaining({ unreadOnly: true }))
    expect(a.result.current).toEqual({ messages: 3, chats: 1, capped: false })
    expect(b.result.current).toEqual(a.result.current)

    page = [session('wxid_a', 3), session('room@chatroom', 4)]
    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'sessions.changed' })
        listener({ type: 'sessions.changed' })
      }
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(a.result.current).toEqual({ messages: 7, chats: 2, capped: false })

    a.unmount()
    b.unmount()
    expect(listeners.size).toBe(0)
  })

  it('asks nothing while switched off, and shows no count when the substrate cannot answer', async () => {
    const off = renderHook(() => useWechatUnread(false))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(off.result.current).toBeUndefined()
    off.unmount()

    invokeMock.mockRejectedValue(new Error('not connected'))
    const on = renderHook(() => useWechatUnread())
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(on.result.current).toBeUndefined()
  })
})
