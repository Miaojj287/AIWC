import { describe, expect, it } from 'vitest'
import { composerKeyAction, newlineKeyLabel, queueKeyLabel, sendKeyLabel } from './sendKeys'

const key = (over: Partial<KeyboardEvent> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...over,
})
const opts = (over: Partial<Parameters<typeof composerKeyAction>[1]> = {}) => ({
  sendKey: 'enter' as const,
  mac: true,
  streaming: false,
  canQueue: false,
  ...over,
})

describe('composer send keys', () => {
  it('enter mode: ↵ and ⌘↵ send, ⇧↵ is a new line', () => {
    expect(composerKeyAction(key(), opts())).toBe('send')
    expect(composerKeyAction(key({ metaKey: true }), opts())).toBe('send')
    expect(composerKeyAction(key({ shiftKey: true }), opts())).toBeUndefined()
    expect(composerKeyAction(key({ key: 'a' }), opts())).toBeUndefined()
  })

  it('mod-enter mode: only ⌘↵ (Ctrl+Enter on Windows) sends', () => {
    expect(composerKeyAction(key(), opts({ sendKey: 'modEnter' }))).toBeUndefined()
    expect(composerKeyAction(key({ metaKey: true }), opts({ sendKey: 'modEnter' }))).toBe('send')
    expect(composerKeyAction(key({ ctrlKey: true }), opts({ sendKey: 'modEnter' }))).toBeUndefined()
    expect(composerKeyAction(key({ ctrlKey: true }), opts({ sendKey: 'modEnter', mac: false }))).toBe('send')
  })

  it('⌥↵ queues while a turn runs and sends otherwise', () => {
    expect(composerKeyAction(key({ altKey: true }), opts({ streaming: true, canQueue: true }))).toBe('queue')
    expect(composerKeyAction(key({ altKey: true }), opts())).toBe('send')
  })

  it('labels follow the platform', () => {
    expect(sendKeyLabel('enter', true)).toBe('↵')
    expect(sendKeyLabel('modEnter', true)).toBe('⌘↵')
    expect(sendKeyLabel('modEnter', false)).toBe('Ctrl+Enter')
    expect(newlineKeyLabel('enter', false)).toBe('Shift+Enter')
    expect(queueKeyLabel(true)).toBe('⌥↵')
    expect(queueKeyLabel(false)).toBe('Alt+Enter')
  })
})
