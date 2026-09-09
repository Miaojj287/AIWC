// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiwcBridge, ReplyDraft } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { ReplyDeskTab } from './ReplyDeskTab'
import { __resetReplyDeskForTests, useReplyDeskStore } from './store'

const draft = (id: string, patch: Partial<ReplyDraft> = {}): ReplyDraft => ({
  id,
  source: { channel: 'wechat-ui', peerId: `wxid_${id}`, chatId: `wxid_${id}`, chatType: 'dm', displayName: `联系人${id}` },
  triggerMessageId: `m_${id}`,
  triggerText: '在吗',
  draft: '在的',
  state: 'pending',
  createdAt: 1,
  mode: 'confirm',
  ...patch,
})

const DRAFTS = [draft('failed', { state: 'failed', error: '发送失败', createdAt: 1 }), draft('a', { createdAt: 2 }), draft('b', { createdAt: 3, mode: 'suggest' })]

function fakeBridge(drafts: ReplyDraft[]): AiwcBridge {
  return {
    runtime: 'web',
    platform: 'darwin',
    on: (() => () => {}) as AiwcBridge['on'],
    invoke: (async (channel: string) => {
      if (channel === 'autoreply:listDrafts') return drafts.filter((d) => d.state === 'pending')
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetReplyDeskForTests()
  __setBridgeForTests(fakeBridge(DRAFTS))
  useReplyDeskStore.setState({ state: { loaded: true, drafts: DRAFTS, countdowns: {}, halted: null } })
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

const TAB = { id: 'replydesk:replydesk', kind: 'replydesk', objectId: 'replydesk', title: '回复台' } as const

describe('ReplyDeskTab', () => {
  it('gives the primary 发送 to the oldest pending draft only; every other card is outline', async () => {
    const { container } = render(<ReplyDeskTab tab={TAB} active update={() => {}} requestClose={() => {}} />)
    await waitFor(() => expect(container.querySelectorAll('[data-draft-mode]')).toHaveLength(3))

    // whole-token match: the link-variant name buttons carry `hover:bg-accent/8`, which is not a primary
    const isPrimary = (b: HTMLElement) => b.className.split(/\s+/).includes('bg-accent')
    const primaryButtons = screen.getAllByRole('button').filter(isPrimary)
    expect(primaryButtons).toHaveLength(1)
    expect(primaryButtons[0]?.textContent).toBe('发送')
    const card = primaryButtons[0]?.closest('[data-draft-mode]')
    expect(card?.textContent).toContain('联系人a')

    const [retry] = screen.getAllByRole('button', { name: '重试发送' })
    expect(retry?.className).toContain('border-(--line-16)')
    const sends = screen.getAllByRole('button', { name: '发送' })
    expect(sends).toHaveLength(2)
    expect(sends.filter((b) => b.className.includes('border-(--line-16)'))).toHaveLength(1)
  })
})
