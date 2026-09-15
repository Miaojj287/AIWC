// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { AiwcBridge, ConnectionState, ListSessionsQuery, WxSession } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { SessionList } from './SessionList'

vi.mock('virtua', () => ({
  VList: ({ data, children }: { data: readonly unknown[]; children: (item: unknown) => ReactNode }) => (
    <div>{data.map(children)}</div>
  ),
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
let connection: ConnectionState
/** When set, every session page request fails with this error. */
let listError: Error | undefined

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  requests = []
  connection = 'ready'
  listError = undefined
  __resetShellStoreForTests()
  const bridge = {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: vi.fn(async (channel: string, request: ListSessionsQuery) => {
      if (channel === 'substrate:status') return { connection, sync: { phase: 'idle' } }
      if (channel !== 'substrate:listSessions') throw new Error(`unexpected ${channel}`)
      requests.push(request)
      if (request.limit === 1) return { items: [], total: 100, hasMore: true }
      if (listError) throw listError
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

describe('failed session list', () => {
  it('offers to connect WeChat when the substrate is not connected, whatever the error text says', async () => {
    connection = 'no_config'
    // e.g. an English UI, or a wrapper prefix added by the IPC layer: the text must not matter
    listError = new Error("Error invoking remote method 'substrate:listSessions': WeChat data is not connected yet")
    const openSettings = vi.fn()
    const off = onCommand('tab.openSettings', openSettings)
    render(<SessionList query="" activeObjectId={null} />)
    await act(async () => {})

    expect(screen.getByText('尚未连接微信')).toBeTruthy()
    expect(screen.queryByText('会话加载失败')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
    expect(openSettings).toHaveBeenCalledWith({ page: 'account' })
    off()
  })

  it('treats a locked database like a missing connection', async () => {
    connection = 'locked'
    listError = new Error('database is locked')
    render(<SessionList query="" activeObjectId={null} />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: '连接微信' })).toBeTruthy()
  })

  it('shows a retryable load error when the substrate is connected, even if the text mentions the connection', async () => {
    connection = 'ready'
    listError = new Error('尚未连接微信数据')
    render(<SessionList query="" activeObjectId={null} />)
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toContain('会话加载失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '连接微信' })).toBeNull()
  })

  it('keeps the loading rows while the substrate is still connecting', async () => {
    connection = 'connecting'
    listError = new Error('尚未连接微信数据')
    render(<SessionList query="" activeObjectId={null} />)
    await act(async () => {})

    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '连接微信' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
