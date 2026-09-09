import { beforeEach, describe, expect, it } from 'vitest'
import { useTabsStore } from '@/workspace/tabsStore'
import { __resetShellStoreForTests, hasActiveListFilters, useShellStore } from './shellStore'

const tabs = () => useTabsStore.getState()
const shell = () => useShellStore.getState()

beforeEach(() => {
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
})

describe('shellStore.setRail', () => {
  it('activates the last tab of the selected function and never closes tabs', () => {
    tabs().open({ kind: 'chat', objectId: 's1', title: '产品市场群' })
    tabs().open({ kind: 'chat', objectId: 's2', title: '家庭群' })
    tabs().open({ kind: 'autoreply', objectId: 's1', title: '自动回复 · 产品市场群' })
    expect(tabs().activeId).toBe('autoreply:s1')

    shell().setRail('chat')
    expect(shell().railFunction).toBe('chat')
    expect(tabs().activeId).toBe('chat:s2')
    expect(tabs().tabs).toHaveLength(3)

    shell().setRail('autoreply')
    expect(tabs().activeId).toBe('autoreply:s1')
    expect(tabs().tabs).toHaveLength(3)
  })

  it('shows the empty state (no active tab) when the function has no tab yet', () => {
    tabs().open({ kind: 'chat', objectId: 's1', title: '产品市场群' })
    shell().setRail('clone')
    expect(tabs().activeId).toBeNull()
    expect(tabs().tabs).toHaveLength(1)
    // coming back restores the chat tab
    shell().setRail('chat')
    expect(tabs().activeId).toBe('chat:s1')
  })

  it('does not touch the active tab when re-selecting the current function without tabs', () => {
    tabs().open({ kind: 'settings', objectId: 'settings', title: '设置' })
    shell().setRail('chat')
    expect(tabs().activeId).toBe('settings:settings')
  })

  it('forgets a closed tab so the function falls back to its empty state', () => {
    tabs().open({ kind: 'chat', objectId: 's1', title: 'A' })
    tabs().open({ kind: 'settings', objectId: 'settings', title: '设置' })
    tabs().close('chat:s1')
    shell().setRail('clone')
    shell().setRail('chat')
    expect(tabs().activeId).toBeNull()
  })

  it('resets header query / segment / filters when the function changes', () => {
    shell().setListQuery('产品')
    shell().setListSegment('group')
    shell().setListFilter('unreadOnly', true)
    expect(hasActiveListFilters(shell(), 'all')).toBe(true)
    shell().setRail('chat') // same function: keep
    expect(shell().listQuery).toBe('产品')
    shell().setRail('autoreply')
    expect(shell().listQuery).toBe('')
    expect(shell().listSegment).toBeNull()
    expect(shell().listFilters).toEqual({})
    expect(hasActiveListFilters(shell(), 'all')).toBe(false)
  })
})

describe('list filters', () => {
  it('toggles and clears extra filters', () => {
    shell().setListFilter('mutedOnly', true)
    shell().setListFilter('unreadOnly', true)
    shell().setListFilter('mutedOnly', false)
    expect(shell().listFilters).toEqual({ unreadOnly: true })
    shell().setListSegment('dm')
    shell().clearListFilters()
    expect(shell().listFilters).toEqual({})
    expect(shell().listSegment).toBeNull()
  })

  it('marks the agent strip unread', () => {
    shell().setAgentUnread(true)
    expect(shell().agentUnread).toBe(true)
    shell().setAgentUnread(false)
    expect(shell().agentUnread).toBe(false)
  })
})
