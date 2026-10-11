import { DEFAULT_APPEARANCE, panelBackgroundFor } from '@aiwc/protocol'
import { describe, expect, it, vi } from 'vitest'
import { applyNativeChrome, nativeChromeColors, resolveChromeMode, titleBarOverlayFor } from './nativeChrome'

const custom = {
  light: { accent: '#4e82ef', background: '#fafafa', surface: '#ececec', foreground: '#111111', contrast: 35 },
  dark: { accent: '#4e82ef', background: '#101010', surface: '#2a2a2a', foreground: '#f5f5f5', contrast: 81 },
}

describe('native chrome colours', () => {
  it('matches the continuous window frame instead of the brighter navigation surface', () => {
    expect(nativeChromeColors({ theme: 'dark', appearance: DEFAULT_APPEARANCE }, false).background).toBe('#292929')
    expect(nativeChromeColors({ theme: 'light', appearance: DEFAULT_APPEARANCE }, true).background).toBe('#f2f2f2')
  })

  it('follows the OS only while the theme is system', () => {
    expect(resolveChromeMode('system', true)).toBe('dark')
    expect(resolveChromeMode('system', false)).toBe('light')
    expect(resolveChromeMode('light', true)).toBe('light')
    expect(resolveChromeMode('dark', false)).toBe('dark')
  })

  it('paints the frame ground and foreground of the resolved palette', () => {
    expect(nativeChromeColors({ theme: 'light', appearance: custom }, true)).toEqual({
      background: '#f2f2f2',
      foreground: '#111111',
    })
    expect(nativeChromeColors({ theme: 'system', appearance: custom }, true)).toEqual({
      background: '#1d1d1d',
      foreground: '#f5f5f5',
    })
  })

  it('falls back to the default palette when none was saved yet', () => {
    expect(nativeChromeColors({ theme: 'light' } as never, false)).toEqual({
      background: panelBackgroundFor(DEFAULT_APPEARANCE.light),
      foreground: DEFAULT_APPEARANCE.light.foreground,
    })
  })

  it('maps the colours onto the Windows caption buttons', () => {
    expect(titleBarOverlayFor({ background: '#ececec', foreground: '#111111' }, 32)).toEqual({
      color: '#ececec',
      symbolColor: '#111111',
      height: 32,
    })
  })
})

describe('applyNativeChrome', () => {
  const target = () => ({ setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() })
  const colors = { background: '#ececec', foreground: '#111111' }

  it('recolours the caption buttons and the opaque base on Windows', () => {
    const win = target()
    applyNativeChrome(win, 'win32', colors, { transparent: false, overlayHeight: 32 })
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#ececec', symbolColor: '#111111', height: 32 })
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#ececec')
  })

  it('leaves the base transparent while 透明效果 is active and never touches caption buttons on macOS', () => {
    const win = target()
    applyNativeChrome(win, 'darwin', colors, { transparent: true, overlayHeight: 32 })
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled()
    expect(win.setBackgroundColor).not.toHaveBeenCalled()
    applyNativeChrome(win, 'darwin', colors, { transparent: false, overlayHeight: 32 })
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#ececec')
  })

  it('tolerates a window without titleBarOverlay support', () => {
    const win = { setBackgroundColor: vi.fn() }
    expect(() => applyNativeChrome(win, 'win32', colors, { transparent: false, overlayHeight: 32 })).not.toThrow()
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#ececec')
  })
})
