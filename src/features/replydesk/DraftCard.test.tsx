// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplyDraft } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { DraftCard } from './DraftCard'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

const draft = (patch: Partial<ReplyDraft> = {}): ReplyDraft => ({
  id: 'd1',
  source: { channel: 'wechat-ui', peerId: 'wxid_p', chatId: 'wxid_p', chatType: 'dm', displayName: '小明' },
  triggerMessageId: 'm1',
  triggerText: '明天有空吗',
  draft: '有空，几点？',
  state: 'pending',
  createdAt: 1_700_000_000_000,
  mode: 'confirm',
  ...patch,
})

const renderCard = (d: ReplyDraft, primary?: boolean) => render(<DraftCard draft={d} primary={primary} remainingMs={undefined} countdownTotalMs={5000} onDismiss={() => {}} />)

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('DraftCard buttons', () => {
  it('renders 发送 as outline by default and primary only when asked (one primary per view)', () => {
    const { unmount } = renderCard(draft())
    const outline = screen.getByRole('button', { name: '发送' })
    expect(outline.className).toContain('border-(--line-16)')
    expect(outline.className).not.toContain('bg-accent')
    unmount()

    renderCard(draft(), true)
    const primary = screen.getByRole('button', { name: '发送' })
    expect(primary.className).toContain('bg-accent')
    // the other actions never become primary
    expect(screen.getByRole('button', { name: '修改后发送' }).className).toContain('border-(--line-16)')
    expect(screen.getByRole('button', { name: '拒绝' }).className).toContain('bg-line-8')
  })

  it('applies the same rule to 重试发送 on a failed draft', () => {
    const { unmount } = renderCard(draft({ state: 'failed', error: '注入后未在数据库读回' }))
    expect(screen.getByRole('button', { name: '重试发送' }).className).toContain('border-(--line-16)')
    unmount()

    renderCard(draft({ state: 'failed', error: '注入后未在数据库读回' }), true)
    expect(screen.getByRole('button', { name: '重试发送' }).className).toContain('bg-accent')
  })

  it('shows the source name as a kit link Button that opens the chat at the trigger message', () => {
    const openChat = vi.fn()
    const off = onCommand('tab.openChat', openChat)
    try {
      renderCard(draft())
      const link = screen.getByRole('button', { name: '小明' })
      expect(link.className).toContain('text-accent')
      expect(link.className).toContain('rounded-control')
      fireEvent.click(link)
      expect(openChat).toHaveBeenCalledWith({ sessionId: 'wxid_p', title: '小明', focusMessageId: 'm1' })
    } finally {
      off()
    }
  })
})
