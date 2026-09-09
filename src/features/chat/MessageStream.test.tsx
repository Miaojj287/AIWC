// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { StreamRow } from './streamModel'
import { MessageStream } from './MessageStream'

const { scrollToIndex } = vi.hoisted(() => ({ scrollToIndex: vi.fn() }))

vi.mock('virtua', async () => {
  const React = await import('react')
  return {
    Virtualizer: React.forwardRef(function Virtualizer(
      { data, children }: { data: readonly unknown[]; children: (item: unknown, index: number) => ReactNode },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex, scrollOffset: 0, scrollSize: 0, viewportSize: 0 }))
      return <div>{data.map((item, index) => children(item, index))}</div>
    }),
  }
})

vi.mock('./MessageRow', () => ({
  DayPill: () => <div />,
  MessageRow: () => <div />,
}))

let frames: Array<{ id: number; callback: FrameRequestCallback }>
let nextFrame: number

beforeEach(() => {
  frames = []
  nextFrame = 1
  scrollToIndex.mockReset()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.push({ id, callback })
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter((frame) => frame.id !== id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const rows: StreamRow[] = [
  { kind: 'message', id: 'm1', message: { id: 'm1', sessionId: 's', seq: 1, createdAt: 1, senderId: 'a', isSelf: false, kind: 'text', text: 'old', anchor: { sessionId: 's', messageId: 'm1', seq: 1, createdAt: 1 } } },
  { kind: 'message', id: 'm2', message: { id: 'm2', sessionId: 's', seq: 2, createdAt: 2, senderId: 'a', isSelf: false, kind: 'text', text: 'latest', anchor: { sessionId: 's', messageId: 'm2', seq: 2, createdAt: 2 } } },
]

it('waits for measurement and corrects the initial scroll to the latest row', () => {
  const noop = () => {}
  render(
    <MessageStream
      rows={rows}
      loading={false}
      error={undefined}
      hasOlder={false}
      loadingOlder={false}
      hasNewer={false}
      loadingNewer={false}
      lastChange="replace"
      windowKey={1}
      focusId={undefined}
      focusNonce={0}
      onFocused={noop}
      onLoadOlder={noop}
      onLoadNewer={noop}
      onRetry={noop}
      isGroup={false}
      selectMode={false}
      selectedIds={new Set()}
      mac
      filtered={false}
      onCopy={noop}
      onQuote={noop}
      onToggleSelect={noop}
      onJumpToTime={noop}
      onDeleteLocal={noop}
      onOpenImage={noop}
    />,
  )

  expect(scrollToIndex).not.toHaveBeenCalled()
  act(() => frames.shift()?.callback(0))
  expect(scrollToIndex).toHaveBeenCalledTimes(1)
  expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'end' })
  act(() => frames.shift()?.callback(16))
  expect(scrollToIndex).toHaveBeenCalledTimes(2)
})
