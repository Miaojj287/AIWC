// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiwcBridge } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { registerObjectList, type ObjectListProps as BodyProps } from '@/shell/objectListRegistry'
import { __resetShellStoreForTests, useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { useListCounts, useListFilterOptions } from './listHeaderContext'
import { ObjectList, selectActiveObjectId } from './ObjectList'

const FILTERS = [{ id: 'unreadOnly', label: '仅未读' }]
let seen: BodyProps[] = []
function FakeBody(props: BodyProps) {
  seen.push(props)
  useListCounts({ all: 42, dm: 26, group: 16 })
  useListFilterOptions(FILTERS)
  useEffect(() => () => undefined, [])
  return <div data-testid="body">{props.query || '(空)'}</div>
}

registerObjectList({
  fn: 'chat',
  title: '会话',
  component: FakeBody,
  segments: [
    { id: 'all', label: '全部' },
    { id: 'dm', label: '单聊' },
    { id: 'group', label: '群聊' },
  ],
})

function fakeBridge(): AiwcBridge {
  return {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: (async (channel: string) => {
      if (channel === 'substrate:status') return { connection: 'ready', sync: { phase: 'idle', lastSyncedAt: new Date(2026, 8, 6, 14, 32).getTime() } }
      if (channel === 'substrate:sync') return { phase: 'idle', lastSyncedAt: Date.now() }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

beforeEach(() => {
  seen = []
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
  __setBridgeForTests(fakeBridge())
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('ObjectList frame', () => {
  it('renders the registered body, live chip counts and the extra-filter menu trigger', async () => {
    render(<ObjectList mac />)
    expect(screen.getByTestId('body').textContent).toContain('(空)')
    await act(async () => {})
    expect(screen.getByRole('button', { name: /全部/ }).textContent).toContain('42')
    expect(screen.getByRole('button', { name: /单聊/ }).textContent).toContain('26')
    expect(screen.getByRole('button', { name: /群聊/ }).textContent).toContain('16')
    expect(screen.getByRole('button', { name: '更多筛选' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
  })

  it('drives segment / query through the shell store and offers 清除筛选 once a filter is active', async () => {
    render(<ObjectList mac />)
    fireEvent.click(screen.getByRole('button', { name: /群聊/ }))
    expect(useShellStore.getState().listSegment).toBe('group')
    expect(screen.getByRole('button', { name: /群聊/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '产品' } })
    expect(useShellStore.getState().listQuery).toBe('产品')
    expect(screen.getByTestId('body').textContent).toContain('产品')

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(useShellStore.getState().listSegment).toBeNull()
    // selecting the first segment again maps back to null (= default)
    fireEvent.click(screen.getByRole('button', { name: /全部/ }))
    expect(useShellStore.getState().listSegment).toBeNull()
  })

  it('passes the active tab’s object as the selection and focuses the search on ⌘K requests', async () => {
    useTabsStore.getState().open({ kind: 'chat', objectId: 's7', title: 'X' })
    render(<ObjectList mac />)
    expect(seen.at(-1)?.activeObjectId).toBe('s7')
    act(() => useShellStore.getState().requestSearchFocus())
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
  })

  it('falls back to a frame-level empty state when no list is registered for the function', () => {
    act(() => useShellStore.getState().setRail('clone'))
    render(<ObjectList mac />)
    expect(screen.getByText('此功能暂无列表')).toBeTruthy()
  })
})

describe('selectActiveObjectId', () => {
  const tabs = [
    { id: 'chat:s1', kind: 'chat' as const, objectId: 's1' },
    { id: 'settings:settings', kind: 'settings' as const, objectId: 'settings' },
    { id: 'autoreply:s2', kind: 'autoreply' as const, objectId: 's2' },
  ]
  it('prefers the active tab when it belongs to the function, else the function’s last tab', () => {
    expect(selectActiveObjectId(tabs, 'chat:s1', {}, 'chat')).toBe('s1')
    expect(selectActiveObjectId(tabs, 'settings:settings', { chat: 'chat:s1' }, 'chat')).toBe('s1')
    expect(selectActiveObjectId(tabs, 'autoreply:s2', { chat: 'chat:s1' }, 'autoreply')).toBe('s2')
    expect(selectActiveObjectId(tabs, 'autoreply:s2', {}, 'chat')).toBeNull()
    expect(selectActiveObjectId(tabs, null, { chat: 'chat:gone' }, 'chat')).toBeNull()
  })
})
