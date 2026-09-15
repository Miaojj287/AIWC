import { describe, expect, it, vi } from 'vitest'
import {
  OPAQUE_BACKGROUND,
  TRANSPARENT_BACKGROUND,
  VIBRANCY_MATERIAL,
  applyTransparency,
  supportsTransparency,
  transparencyOptionsFor,
} from './transparency'

describe('透明效果 platform gate', () => {
  it('is available on macOS and on Windows 11 22H2+, never on older Windows or Linux', () => {
    expect(supportsTransparency('darwin', '15.4.0')).toBe(true)
    expect(supportsTransparency('darwin')).toBe(true)
    expect(supportsTransparency('win32', '10.0.19045')).toBe(false) // Windows 10 22H2
    expect(supportsTransparency('win32', '10.0.22000')).toBe(false) // Windows 11 21H2: no acrylic material
    expect(supportsTransparency('win32', '10.0.22621')).toBe(true)
    expect(supportsTransparency('win32', '10.0.26100')).toBe(true)
    expect(supportsTransparency('win32')).toBe(false)
    expect(supportsTransparency('linux', '6.8.0')).toBe(false)
  })
})

describe('constructor options', () => {
  it('turns the material on from the first frame when the setting is on', () => {
    expect(transparencyOptionsFor('darwin', true)).toEqual({
      visualEffectState: 'active',
      vibrancy: VIBRANCY_MATERIAL,
      backgroundColor: TRANSPARENT_BACKGROUND,
    })
    expect(transparencyOptionsFor('win32', true, '10.0.22631')).toEqual({
      backgroundMaterial: 'acrylic',
      backgroundColor: TRANSPARENT_BACKGROUND,
    })
  })

  it('keeps the window opaque when off or unsupported, but pins the macOS effect state for a later runtime toggle', () => {
    expect(transparencyOptionsFor('darwin', false)).toEqual({ visualEffectState: 'active' })
    expect(transparencyOptionsFor('win32', true, '10.0.19045')).toEqual({})
    expect(transparencyOptionsFor('win32', false, '10.0.22631')).toEqual({})
    expect(transparencyOptionsFor('linux', true)).toEqual({})
  })
})

describe('runtime toggle', () => {
  const target = () => ({ setVibrancy: vi.fn(), setBackgroundMaterial: vi.fn(), setBackgroundColor: vi.fn() })

  it('swaps the macOS vibrancy and the page base colour together', () => {
    const win = target()
    applyTransparency(win, 'darwin', true)
    expect(win.setVibrancy).toHaveBeenLastCalledWith(VIBRANCY_MATERIAL)
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(TRANSPARENT_BACKGROUND)
    applyTransparency(win, 'darwin', false)
    expect(win.setVibrancy).toHaveBeenLastCalledWith(null)
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(OPAQUE_BACKGROUND)
    expect(win.setBackgroundMaterial).not.toHaveBeenCalled()
  })

  it('uses the acrylic material on Windows 11 and does nothing where the OS cannot blur', () => {
    const win = target()
    applyTransparency(win, 'win32', true, '10.0.22621')
    expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith('acrylic')
    applyTransparency(win, 'win32', false, '10.0.22621')
    expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith('none')

    const old = target()
    applyTransparency(old, 'win32', true, '10.0.19045')
    applyTransparency(old, 'linux', true)
    expect(old.setBackgroundMaterial).not.toHaveBeenCalled()
    expect(old.setVibrancy).not.toHaveBeenCalled()
    expect(old.setBackgroundColor).not.toHaveBeenCalled()
  })
})
