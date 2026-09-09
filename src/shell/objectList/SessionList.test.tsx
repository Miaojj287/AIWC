// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { AiwcBridge, ListSessionsQuery, WxSession } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { SessionList } from './SessionList'

vi.mock('virtua', () => ({
  VList: ({ data, children }: { data: readonly unknown[]; children: (item: unknown) => ReactNode }) => <div>{data.map(children)}</div>,
}))

const sessions: WxSession[] = Array.from({ length: 20 }, (_, i) => ({
  id: `wxid_${i}`,
  kind: 'dm',
  title: `Contact ${i}`,
  unread: 0,
  pinned: false,
  muted: false,
  lastMessageAt: 10_000 - i,
}))

let requests: ListSessionsQuery[]

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  requests = []
  __resetShellStoreForTests()
  const bridge = {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: vi.fn(async (channel: string, request: ListSessionsQuery) => {
      if (channel !== 'substrate:listSessions') throw new Error(`unexpected ${channel}`)
      requests.push(request)
      if (request.limit === 1) return { items: [], total: 100, hasMore: true }
      if ((request.offset ?? 0) > 0) throw new Error('the first paint must not wait for page two')
      return { items: sessions, total: 100, hasMore: true }
    }),
  } as unknown as AiwcBridge
  __setBridgeForTests(bridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

it('renders the first session page without fetching the entire catalog', async () => {
  render(<SessionList query="" activeObjectId={null} />)
  await act(async () => {})

  expect(screen.getByText('Contact 0')).toBeTruthy()
  const pageRequests = requests.filter((request) => request.limit !== 1)
  expect(pageRequests).toEqual([{ kind: 'all', offset: 0, limit: 60 }])
})
