// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearToasts, getToasts } from '@/kit'
import { __resetShellStoreForTests, useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { onCommand, runCommand } from './commands'
import { descriptorFor, fileName, installTabCommands, prefixedTitle, quoteRefFor } from './tabCommands'

const tabs = () => useTabsStore.getState()

let uninstall: (() => void) | undefined
const requestClose = vi.fn()

beforeEach(() => {
  __resetShellStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
  requestClose.mockReset()
  uninstall = installTabCommands({ requestClose })
})

afterEach(() => {
  uninstall?.()
  clearToasts()
})

describe('descriptorFor', () => {
  it('builds one tab per object and carries per-tab state', () => {
    expect(descriptorFor('tab.openChat', { sessionId: 's1', title: '产品市场群', focusMessageId: 'm9' })).toEqual({
      kind: 'chat',
      objectId: 's1',
      title: '产品市场群',
      state: { focusMessageId: 'm9' },
    })
    expect(descriptorFor('tab.openAutoReply', { sessionId: 's1', title: '产品市场群' })).toMatchObject({ kind: 'autoreply', title: '自动回复 · 产品市场群' })
    expect(descriptorFor('tab.openClone', { contactId: 'c1', title: '张明' })).toMatchObject({ kind: 'clone', objectId: 'c1', title: '克隆 · 张明' })
    expect(descriptorFor('tab.openFile', { path: '/tmp/out/周报草稿.md', title: '' })).toMatchObject({ kind: 'file', title: '周报草稿.md' })
    expect(descriptorFor('tab.openSettings', { page: 'ai', highlight: 'ai.apiKey' })).toEqual({ kind: 'settings', objectId: 'settings', title: '设置', state: { page: 'ai', highlight: 'ai.apiKey' } })
    expect(descriptorFor('tab.openSettings', undefined)).toEqual({ kind: 'settings', objectId: 'settings', title: '设置', state: undefined })
    expect(descriptorFor('tab.openReplyDesk', undefined)).toMatchObject({ kind: 'replydesk' })
    expect(descriptorFor('tab.openDiary', { date: '2026-09-05' })).toMatchObject({ kind: 'diary', state: { date: '2026-09-05' } })
    expect(descriptorFor('tab.openKit', undefined)).toMatchObject({ kind: 'kit', objectId: 'gallery' })
    expect(descriptorFor('tab.openChat', undefined)).toBeUndefined()
  })

  it('never double-prefixes titles and picks file names off paths', () => {
    expect(prefixedTitle('自动回复', '自动回复 · 家庭群')).toBe('自动回复 · 家庭群')
    expect(fileName('C:\\Users\\me\\report.md')).toBe('report.md')
    expect(fileName('plain.md')).toBe('plain.md')
  })
})

describe('installTabCommands', () => {
  it('opens tabs, de-duplicates on the object and switches the rail to the tab function', () => {
    runCommand('tab.openChat', { sessionId: 's1', title: 'A' })
    runCommand('tab.openChat', { sessionId: 's2', title: 'B' })
    runCommand('tab.openChat', { sessionId: 's1', title: 'A' })
    expect(tabs().tabs.map((t) => t.id)).toEqual(['chat:s1', 'chat:s2'])
    expect(tabs().activeId).toBe('chat:s1')

    runCommand('tab.openAutoReply', { sessionId: 's1', title: 'A' })
    expect(useShellStore.getState().railFunction).toBe('autoreply')
    expect(tabs().activeId).toBe('autoreply:s1')
    expect(tabs().tabs).toHaveLength(3)
  })

  it('merges state into an existing settings tab instead of opening a second one', () => {
    runCommand('tab.openSettings', { page: 'general' })
    runCommand('tab.openSettings', { highlight: 'general.theme' })
    runCommand('tab.openSettings', {})
    const settings = tabs().tabs.filter((t) => t.kind === 'settings')
    expect(settings).toHaveLength(1)
    expect(settings[0]?.state).toEqual({ page: 'general', highlight: 'general.theme' })
    expect(useShellStore.getState().railFunction).toBe('chat') // settings has no rail function
  })

  it('routes closeActive through the dirty guard and reopens the last closed tab', () => {
    runCommand('tab.openChat', { sessionId: 's1', title: 'A' })
    runCommand('tab.openChat', { sessionId: 's2', title: 'B' })
    runCommand('tab.closeActive')
    expect(requestClose).toHaveBeenCalledWith('chat:s2')

    tabs().close('chat:s2')
    expect(tabs().tabs.map((t) => t.id)).toEqual(['chat:s1'])
    runCommand('tab.reopenClosed')
    expect(tabs().tabs.map((t) => t.id)).toEqual(['chat:s1', 'chat:s2'])
    expect(tabs().activeId).toBe('chat:s2')
  })

  it('rail.select restores that function’s last tab without closing anything', () => {
    runCommand('tab.openChat', { sessionId: 's1', title: 'A' })
    runCommand('tab.openClone', { contactId: 'c1', title: '张明' })
    expect(tabs().activeId).toBe('clone:c1')
    runCommand('rail.select', { fn: 'chat' })
    expect(useShellStore.getState().railFunction).toBe('chat')
    expect(tabs().activeId).toBe('chat:s1')
    expect(tabs().tabs).toHaveLength(2)
  })

  it('⌘⇧A quotes the object behind the active tab, or explains when there is none', () => {
    const quoted = vi.fn()
    const off = onCommand('agent.quote', quoted)
    runCommand('tab.openChat', { sessionId: 's1', title: '产品市场群' })
    runCommand('agent.quoteActiveTab')
    expect(quoted).toHaveBeenCalledWith({ kind: 'session', id: 's1', label: '产品市场群' })

    runCommand('tab.openSettings', {})
    runCommand('agent.quoteActiveTab')
    expect(quoted).toHaveBeenCalledTimes(1)
    expect(getToasts().some((t) => t.text.includes('没有可引用'))).toBe(true)
    off()
  })

  it('maps tab kinds to @ references', () => {
    expect(quoteRefFor({ id: 'autoreply:s1', kind: 'autoreply', objectId: 's1', title: '自动回复 · 家庭群' })).toEqual({ kind: 'session', id: 's1', label: '家庭群' })
    expect(quoteRefFor({ id: 'file:/a.md', kind: 'file', objectId: '/a.md', title: 'a.md' })).toEqual({ kind: 'file', id: '/a.md', label: 'a.md' })
    expect(quoteRefFor({ id: 'kit:gallery', kind: 'kit', objectId: 'gallery', title: '组件库' })).toBeUndefined()
  })
})
