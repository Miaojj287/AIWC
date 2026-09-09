// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SubstrateEvent, WxMessage } from '@aiwc/protocol'
import { useMessages } from './useMessages'
import { DEFAULT_FILTERS } from './filters'

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listener: undefined as undefined | ((e: SubstrateEvent) => void) }))
vi.mock('@/platform/hooks', () => ({
  invoke: bridge.invoke,
  useBridgeEvent: (_channel: string, listener: (e: SubstrateEvent) => void) => { bridge.listener = listener },
}))
afterEach(() => { cleanup(); bridge.invoke.mockReset() })
const message = (seq: number): WxMessage => ({ id: String(seq), sessionId: 's', seq, createdAt: seq, senderId: 'u', isSelf: false, kind: 'text', text: 'test', anchor: { sessionId: 's', messageId: String(seq), seq, createdAt: seq } })

it('drains more than 60 live messages from one notification', async () => {
  bridge.invoke.mockResolvedValueOnce({ items: [message(1)], hasMore: false })
    .mockResolvedValueOnce({ items: Array.from({ length: 60 }, (_, i) => message(i + 2)), hasMore: true })
    .mockResolvedValueOnce({ items: [message(62)], hasMore: false })
  const { result } = renderHook(() => useMessages('s', DEFAULT_FILTERS))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => bridge.listener?.({ type: 'messages.changed', sessionIds: ['s'] }))
  await waitFor(() => expect(result.current.messages).toHaveLength(62))
  expect(bridge.invoke.mock.calls[2]?.[1]).toMatchObject({ afterSeq: 61 })
})
