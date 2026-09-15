// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearToasts } from '@/kit'
import { invoke } from '@/platform/hooks'
import { ExportDialog } from './ExportDialog'
import { DEFAULT_FILTERS } from './filters'

vi.mock('@/platform/hooks', () => ({ invoke: vi.fn(async () => ({ path: '/exports/room.md' })) }))
vi.mock('@/platform/openExternal', () => ({ openLocalPath: vi.fn() }))

// Radix measures popper content with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub))
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  clearToasts()
  vi.mocked(invoke).mockClear()
})

// Radix finishes mounting the dialog on the next tick.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

it('sends the sender filter with a "current filter" export', async () => {
  render(
    <ExportDialog
      open
      onOpenChange={() => {}}
      sessionId="room@chatroom"
      sessionTitle="Room"
      filters={{ ...DEFAULT_FILTERS, senderIds: ['wxid_a', 'wxid_b'] }}
      selectedIds={new Set()}
    />,
  )
  await settle()
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      'substrate:export',
      expect.objectContaining({ sessionId: 'room@chatroom', senderIds: ['wxid_a', 'wxid_b'] }),
    ),
  )
})
