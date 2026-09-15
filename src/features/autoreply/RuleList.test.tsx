// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule } from '@aiwc/protocol'
import { __resetReplyDeskForTests } from '@/features/replydesk/store'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { RuleList } from './RuleList'
import { newRule } from './ruleModel'
import { chat, createSessionsBridge, type SessionsBridge } from './testing/sessionsBridge'

vi.mock('virtua', () => ({
  VList: ({
    data,
    children,
    role,
    ...rest
  }: {
    data: readonly unknown[]
    children: (item: unknown) => ReactNode
    role?: string
    'aria-label'?: string
  }) => (
    <div role={role} aria-label={rest['aria-label']}>
      {data.map((item) => children(item))}
    </div>
  ),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** 1,200 chats — more than the 500 the list used to load. */
const LONG_LIST = Array.from({ length: 1200 }, (_, i) => chat(i))
const ruleFor = (sessionId: string): AutoReplyRule => ({ ...newRule(sessionId), id: `rule_${sessionId}` })

let harness: SessionsBridge

function install(sessions = LONG_LIST, rules: AutoReplyRule[] = []) {
  harness = createSessionsBridge(sessions, rules)
  __setBridgeForTests(harness.bridge)
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetShellStoreForTests()
  __resetReplyDeskForTests()
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

describe('RuleList with more chats than one page', () => {
  it('lists the rule of a chat far beyond the first pages, fetching one page at a time', async () => {
    install(LONG_LIST, [ruleFor('wxid_900')])
    render(<RuleList query="" activeObjectId={null} />)

    expect(await screen.findByRole('switch', { name: 'Chat 900 自动回复' })).toBeTruthy()
    expect(screen.getByText('Chat 0')).toBeTruthy()
    expect(harness.requests.length).toBeGreaterThan(0)
    expect(harness.requests.every((r) => r.limit <= 60)).toBe(true)
  })

  it('searches on the backend, so a chat past the first 500 can be found and set up', async () => {
    install()
    render(<RuleList query="Chat 1150" activeObjectId={null} />)

    expect(await screen.findByText('Chat 1150')).toBeTruthy()
    expect(harness.requests.some((r) => r.query === 'Chat 1150' && (r.offset ?? 0) === 0)).toBe(true)
  })

  it('respects hasMore: keeps paging past a page of chats that cannot carry a rule', async () => {
    const official = Array.from({ length: 60 }, (_, i) =>
      chat(i, { id: `gh_${i}`, kind: 'official', title: `News ${i}` }),
    )
    install([...official, chat(60), chat(61)])
    render(<RuleList query="" activeObjectId={null} />)

    expect(await screen.findByText('Chat 61')).toBeTruthy()
    await act(async () => {})
    expect(harness.requests.map((r) => r.offset ?? 0)).toEqual([0, 60])
    expect(screen.queryByText('News 0')).toBeNull()
  })
})
