// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { MessageBody, RichText } from './MessageBody'

vi.mock('@/platform/hooks', () => ({
  invoke: vi.fn(async () => undefined),
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

afterEach(cleanup)

describe('<RichText> search highlight', () => {
  it('marks matches with r4 and token colours (accent-30 ground, fg text) in both bubble sides', () => {
    for (const self of [false, true]) {
      const { container, unmount } = render(<RichText text="周报草稿 已发送" self={self} highlight="周报" />)
      const mark = container.querySelector('mark')
      expect(mark).not.toBeNull()
      expect(mark!.textContent).toBe('周报')
      expect(mark!.className).toContain('rounded-[4px]')
      expect(mark!.className).toContain('bg-accent-30')
      expect(mark!.className).toContain('text-fg')
      expect(mark!.className).not.toContain('rounded-[2px]')
      expect(mark!.className).not.toContain('text-white')
      unmount()
    }
  })

  it('renders no <mark> without a highlight query', () => {
    const { container } = render(<RichText text="周报草稿 已发送" self={false} />)
    expect(container.querySelector('mark')).toBeNull()
  })
})

const QUOTE_MESSAGE: WxMessage = {
  id: 'm1',
  sessionId: 's1',
  seq: 1,
  createdAt: 0,
  senderId: 'wxid_b',
  senderName: '李四',
  isSelf: false,
  kind: 'quote',
  text: '收到',
  quote: { senderName: '张三', text: '周报草稿' },
  anchor: { sessionId: 's1', messageId: 'm1', seq: 1, createdAt: 0 },
}

describe('<MessageBody> quote block', () => {
  it("uses the named grey tokens on the other party's side, not fg/N tints", () => {
    render(<MessageBody message={QUOTE_MESSAGE} self={false} onOpenImage={() => {}} />)
    const block = screen.getByText('周报草稿').closest('div') as HTMLElement
    expect(block.className).toContain('border-(--line-25)')
    expect(block.className).toContain('bg-hover-5')
    expect(block.className).not.toMatch(/\b(bg|border)-fg\//)
  })

  it('keeps white overlays on the fixed-blue self bubble (named greys would flip in the light theme)', () => {
    render(<MessageBody message={{ ...QUOTE_MESSAGE, isSelf: true }} self onOpenImage={() => {}} />)
    const block = screen.getByText('周报草稿').closest('div') as HTMLElement
    expect(block.className).toContain('bg-white/10')
    expect(block.className).not.toContain('bg-hover-5')
  })
})

it('renders known WeChat emoji artwork while keeping unknown bracketed text', () => {
  render(<RichText text="你好[微笑][不是表情]" self={false} />)
  expect(screen.getByRole('img', { name: '[微笑]' })).toBeTruthy()
  expect(screen.getByText('你好[不是表情]')).toBeTruthy()
})
