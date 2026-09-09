// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiwcBridge } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetShellStoreForTests } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { onCommand } from './commands'
import { formatShortcut, installShortcuts, matchShortcut, resolveShortcutEnv, shortcutLabel } from './shortcuts'
import { installTabCommands } from './tabCommands'

const key = (overrides: Partial<KeyboardEventInit> & { key: string }) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...overrides })

describe('matchShortcut', () => {
  it('maps ⌘1/2/3 to rail.select with the function payload', () => {
    expect(matchShortcut(key({ key: '1', metaKey: true }), { mac: true })).toMatchObject({ command: 'rail.select', payload: { fn: 'chat' } })
    expect(matchShortcut(key({ key: '2', metaKey: true }), { mac: true })).toMatchObject({ payload: { fn: 'autoreply' } })
    expect(matchShortcut(key({ key: '3', metaKey: true }), { mac: true })).toMatchObject({ payload: { fn: 'clone' } })
  })

  it('uses Ctrl instead of ⌘ off macOS and ignores the wrong modifier', () => {
    expect(matchShortcut(key({ key: 'w', ctrlKey: true }), { mac: false })?.command).toBe('tab.closeActive')
    expect(matchShortcut(key({ key: 'w', metaKey: true }), { mac: false })).toBeUndefined()
    expect(matchShortcut(key({ key: 'w', ctrlKey: true }), { mac: true })).toBeUndefined()
  })

  it('distinguishes shifted chords and upper-case keys', () => {
    expect(matchShortcut(key({ key: 'T', metaKey: true, shiftKey: true }), { mac: true })?.command).toBe('tab.reopenClosed')
    expect(matchShortcut(key({ key: 't', metaKey: true }), { mac: true })).toBeUndefined()
    expect(matchShortcut(key({ key: 'A', metaKey: true, shiftKey: true }), { mac: true })?.command).toBe('agent.quoteActiveTab')
    expect(matchShortcut(key({ key: 'B', metaKey: true, shiftKey: true }), { mac: true })?.command).toBe('objectList.toggleCollapsed')
    expect(matchShortcut(key({ key: 'J', metaKey: true, shiftKey: true }), { mac: true })?.command).toBe('agent.toggleCollapsed')
  })

  it('only enables ⌘⇧K (kit gallery) in web mode', () => {
    expect(matchShortcut(key({ key: 'K', metaKey: true, shiftKey: true }), { mac: true })).toBeUndefined()
    expect(matchShortcut(key({ key: 'K', metaKey: true, shiftKey: true }), { mac: true, web: true })?.command).toBe('tab.openKit')
    expect(matchShortcut(key({ key: 'k', metaKey: true }), { mac: true })?.command).toBe('search.sessions')
  })

  it('maps ⌘, ⌘F ⌘N', () => {
    expect(matchShortcut(key({ key: ',', metaKey: true }), { mac: true })?.command).toBe('tab.openSettings')
    expect(matchShortcut(key({ key: 'f', metaKey: true }), { mac: true })?.command).toBe('search.inPage')
    expect(matchShortcut(key({ key: 'n', metaKey: true }), { mac: true })?.command).toBe('agent.newThread')
  })
})

describe('installShortcuts', () => {
  const offs: Array<() => void> = []
  afterEach(() => {
    for (const off of offs.splice(0)) off()
  })

  it('dispatches the matched command and consumes the event', () => {
    const closeActive = vi.fn()
    const railSelect = vi.fn()
    offs.push(onCommand('tab.closeActive', closeActive), onCommand('rail.select', railSelect), installShortcuts({ mac: true }))

    const w = key({ key: 'w', metaKey: true })
    window.dispatchEvent(w)
    expect(closeActive).toHaveBeenCalledTimes(1)
    expect(w.defaultPrevented).toBe(true)

    window.dispatchEvent(key({ key: '2', metaKey: true }))
    expect(railSelect).toHaveBeenCalledWith({ fn: 'autoreply' })

    const plain = key({ key: 'w' })
    window.dispatchEvent(plain)
    expect(closeActive).toHaveBeenCalledTimes(1)
    expect(plain.defaultPrevented).toBe(false)
  })

  it('stops listening after uninstall', () => {
    const spy = vi.fn()
    offs.push(onCommand('search.sessions', spy))
    const off = installShortcuts({ mac: true })
    off()
    window.dispatchEvent(key({ key: 'k', metaKey: true }))
    expect(spy).not.toHaveBeenCalled()
  })
})

/* ⌘⇧K end to end: keydown → shortcut table → command bus → tabCommands → tabsStore (kit gallery tab). */
describe('⌘⇧K opens the kit gallery tab in web mode', () => {
  const offs: Array<() => void> = []
  const fakeBridge = (runtime: AiwcBridge['runtime']): AiwcBridge => ({ runtime, platform: 'darwin', on: () => () => {}, invoke: (async () => undefined) as AiwcBridge['invoke'] })
  const activeTab = () => useTabsStore.getState().activeId

  beforeEach(() => {
    __resetShellStoreForTests()
    useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
    offs.push(installTabCommands({ requestClose: () => undefined }))
  })
  afterEach(() => {
    for (const off of offs.splice(0)) off()
    __setBridgeForTests(undefined)
  })

  it('dispatches from the raw keydown for both key spellings and consumes the event', () => {
    offs.push(installShortcuts({ mac: true, web: true }))
    const upper = key({ key: 'K', metaKey: true, shiftKey: true })
    window.dispatchEvent(upper)
    expect(upper.defaultPrevented).toBe(true)
    expect(activeTab()).toBe('kit:gallery')
    expect(useTabsStore.getState().tabs.map((t) => t.kind)).toEqual(['kit'])

    useTabsStore.getState().close('kit:gallery')
    window.dispatchEvent(key({ key: 'k', metaKey: true, shiftKey: true }))
    expect(activeTab()).toBe('kit:gallery')
  })

  it('uses Ctrl+Shift+K off macOS and leaves ⌘K (search) alone', () => {
    const search = vi.fn()
    offs.push(onCommand('search.sessions', search), installShortcuts({ mac: false, web: true }))
    window.dispatchEvent(key({ key: 'K', ctrlKey: true, shiftKey: true }))
    expect(activeTab()).toBe('kit:gallery')
    expect(search).not.toHaveBeenCalled()
  })

  it('reads web mode from bridge().runtime when the installer passes no flag', () => {
    __setBridgeForTests(fakeBridge('web'))
    expect(resolveShortcutEnv({ mac: true })).toEqual({ mac: true, web: true })
    offs.push(installShortcuts({ mac: true }))
    window.dispatchEvent(key({ key: 'K', metaKey: true, shiftKey: true }))
    expect(activeTab()).toBe('kit:gallery')
  })

  it('stays off under the electron runtime, before the bridge exists, and when web is explicitly false', () => {
    expect(resolveShortcutEnv({ mac: true })).toEqual({ mac: true, web: false })
    __setBridgeForTests(fakeBridge('electron'))
    expect(resolveShortcutEnv({ mac: true })).toEqual({ mac: true, web: false })
    expect(resolveShortcutEnv({ mac: true, web: false })).toEqual({ mac: true, web: false })
    offs.push(installShortcuts({ mac: true }))
    const e = key({ key: 'K', metaKey: true, shiftKey: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(activeTab()).toBeNull()
  })
})

describe('labels', () => {
  it('formats mac symbols and win/linux words', () => {
    expect(formatShortcut({ key: 't', mod: true, shift: true }, true)).toBe('⌘⇧T')
    expect(formatShortcut({ key: 't', mod: true, shift: true }, false)).toBe('Ctrl+Shift+T')
    expect(formatShortcut({ key: ',', mod: true }, true)).toBe('⌘,')
  })

  it('looks up a command (optionally by payload)', () => {
    expect(shortcutLabel('tab.closeActive', true)).toBe('⌘W')
    expect(shortcutLabel('rail.select', true, { fn: 'clone' })).toBe('⌘3')
    expect(shortcutLabel('toast', true)).toBeUndefined()
  })
})
