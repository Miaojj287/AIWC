import { describe, expect, it } from 'vitest'
import { SHORTCUTS } from './shortcuts'
import { shortcutSheet, unlabelledShortcuts } from './shortcutSheet'

describe('shortcut sheet', () => {
  it('labels every registered shortcut', () => {
    expect(unlabelledShortcuts()).toEqual([])
    const rows = shortcutSheet({ mac: true, web: true, sendKey: 'enter' }).flatMap((g) => g.rows)
    for (const b of SHORTCUTS) expect(rows.some((r) => r.id.startsWith(b.command))).toBe(true)
  })

  it('uses platform labels and hides web-only bindings in the app', () => {
    const find = (mac: boolean, id: string) =>
      shortcutSheet({ mac, web: false, sendKey: 'enter' })
        .flatMap((g) => g.rows)
        .find((r) => r.id === id)?.keys
    expect(find(true, 'tab.reopenClosed')).toBe('⇧⌘T')
    expect(find(false, 'tab.reopenClosed')).toBe('Ctrl+Shift+T')
    expect(find(true, 'app.showShortcuts')).toBe('⌘/')
    expect(find(true, 'tab.openKit')).toBeUndefined()
  })

  it('composer rows follow the send key setting', () => {
    const composer = (sendKey: 'enter' | 'modEnter', mac: boolean) =>
      shortcutSheet({ mac, web: false, sendKey }).find((g) => g.id === 'composer')?.rows ?? []
    expect(composer('enter', true).find((r) => r.id === 'composer.send')?.keys).toBe('↵')
    expect(composer('enter', true).find((r) => r.id === 'composer.newline')?.keys).toBe('⇧↵')
    expect(composer('modEnter', false).find((r) => r.id === 'composer.send')?.keys).toBe('Ctrl+Enter')
    expect(composer('modEnter', false).find((r) => r.id === 'composer.newline')?.keys).toBe('Enter')
  })
})
