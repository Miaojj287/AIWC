import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@aiwc/protocol'
import { __resetTransparencyForTests } from '@/platform/appearance'
import { AppearanceSettings } from './AppearanceSettings'
import { saveConfig } from '../hooks'
vi.mock('../hooks', () => ({ saveConfig: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as { aiwc?: unknown }).aiwc
  __resetTransparencyForTests()
})
describe('appearance settings', () => {
  it('saves only the edited palette while keeping the other mode', () => {
    const general = defaultConfig().general
    render(<AppearanceSettings general={general} />)
    fireEvent.change(screen.getByLabelText('深色强调色'), { target: { value: '#123456' } })
    expect(saveConfig).not.toHaveBeenCalled()
    fireEvent.blur(screen.getByLabelText('深色强调色'))
    expect(saveConfig).toHaveBeenCalledWith({
      general: {
        appearance: { light: general.appearance.light, dark: { ...general.appearance.dark, accent: '#123456' } },
      },
    })
  })
  it('does not save during a contrast drag and commits the final value once', () => {
    render(<AppearanceSettings general={defaultConfig().general} />)
    const slider = screen.getByLabelText('对比度')
    for (let value = 40; value <= 90; value++) fireEvent.change(slider, { target: { value: String(value) } })
    expect(saveConfig).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    expect(saveConfig).toHaveBeenCalledTimes(1)
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({
          appearance: expect.objectContaining({ dark: expect.objectContaining({ contrast: 90 }) }),
        }),
      }),
    )
  })
  it('edits the foreground surface separately from the font color', () => {
    const general = defaultConfig().general
    render(<AppearanceSettings general={general} />)
    fireEvent.change(screen.getByLabelText('深色前景'), { target: { value: '#445566' } })
    fireEvent.blur(screen.getByLabelText('深色前景'))
    expect(saveConfig).toHaveBeenCalledWith({
      general: {
        appearance: {
          light: general.appearance.light,
          dark: { ...general.appearance.dark, surface: '#445566' },
        },
      },
    })
    expect(screen.getByLabelText('深色字体')).toBeTruthy()
  })
  it('selects system mode from its preview', () => {
    render(<AppearanceSettings general={defaultConfig().general} />)
    fireEvent.click(screen.getByRole('button', { name: '跟随系统' }))
    expect(saveConfig).toHaveBeenCalledWith({ general: { theme: 'system' } })
  })
  it('shows 透明效果 on by default on the desktop app and lets the user turn it off', () => {
    ;(window as unknown as { aiwc?: unknown }).aiwc = { runtime: 'electron', platform: 'darwin' }
    render(<AppearanceSettings general={defaultConfig().general} />)
    const toggle = screen.getByRole('switch', { name: '透明效果' })
    expect(toggle.hasAttribute('disabled')).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ general: { transparency: false } })
    expect(screen.getByRole('button', { name: '透明效果说明' })).toBeTruthy()
  })
  it('shows 透明效果 off and disabled where the window cannot blur (web preview)', () => {
    render(<AppearanceSettings general={defaultConfig().general} />)
    const toggle = screen.getByRole('switch', { name: '透明效果' })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
  it('恢复默认外观 restores the edited mode and turns 透明效果 back on', () => {
    ;(window as unknown as { aiwc?: unknown }).aiwc = { runtime: 'electron', platform: 'darwin' }
    const base = defaultConfig().general
    const general = { ...base, transparency: false, appearance: { ...base.appearance, dark: { ...base.appearance.dark, accent: '#123456' } } }
    render(<AppearanceSettings general={general} />)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认外观' }))
    expect(saveConfig).toHaveBeenCalledWith({ general: { appearance: { light: base.appearance.light, dark: base.appearance.dark }, transparency: true } })
  })
})
