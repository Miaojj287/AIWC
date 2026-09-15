// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { newRule } from '../ruleModel'
import { chat, createSessionsBridge, type SessionsBridge } from '../testing/sessionsBridge'
import { CopyRuleDialog } from './CopyRuleDialog'

vi.mock('virtua', () => ({
  Virtualizer: ({ data, children }: { data: readonly unknown[]; children: (item: unknown) => ReactNode }) => (
    <>{data.map((item) => children(item))}</>
  ),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const LONG_LIST = Array.from({ length: 1200 }, (_, i) => chat(i))
const SOURCE: AutoReplyRule = { ...newRule('wxid_0'), id: 'rule_wxid_0' }

let harness: SessionsBridge

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  harness = createSessionsBridge(LONG_LIST, [SOURCE])
  __setBridgeForTests(harness.bridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

describe('CopyRuleDialog with more chats than one page', () => {
  it('finds a chat past the first 500 through a backend search and copies the rule to it', async () => {
    const saved: string[] = []
    const save = harness.bridge.handlers['autoreply:saveRule']
    harness.bridge.handlers['autoreply:saveRule'] = (rule) => {
      saved.push(rule.sessionId)
      return save(rule)
    }
    render(<CopyRuleDialog open rule={SOURCE} sourceTitle="Chat 0" onOpenChange={() => {}} />)

    expect(await screen.findByRole('checkbox', { name: 'Chat 1' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Chat 0' })).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), { target: { value: 'Chat 1150' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chat 1150' }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() => expect(saved).toEqual(['wxid_1150']))
    expect(harness.requests.some((r) => r.query === 'Chat 1150')).toBe(true)
    expect(harness.requests.every((r) => r.limit <= 60)).toBe(true)
  })
})
