import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@aiwc/protocol'
import { AppearanceSettings } from './AppearanceSettings'
import { saveConfig } from '../hooks'
vi.mock('../hooks', () => ({ saveConfig: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('appearance settings', () => {
  it('saves only the edited palette while keeping the other mode', () => {
    const general = defaultConfig().general
    render(<AppearanceSettings general={general} />)
    fireEvent.change(screen.getByLabelText('深色强调色'), { target: { value: '#123456' } })
    expect(saveConfig).not.toHaveBeenCalled()
    fireEvent.blur(screen.getByLabelText('深色强调色'))
    expect(saveConfig).toHaveBeenCalledWith({ general: { appearance: { light: general.appearance.light, dark: { ...general.appearance.dark, accent: '#123456' } } } })
  })
  it('does not save during a contrast drag and commits the final value once', () => {
    render(<AppearanceSettings general={defaultConfig().general} />)
    const slider = screen.getByLabelText('对比度')
    for (let value = 40; value <= 90; value++) fireEvent.change(slider, { target: { value: String(value) } })
    expect(saveConfig).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    expect(saveConfig).toHaveBeenCalledTimes(1)
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ general: expect.objectContaining({ appearance: expect.objectContaining({ dark: expect.objectContaining({ contrast: 90 }) }) }) }))
  })
  it('selects system mode from its preview', () => {
    render(<AppearanceSettings general={defaultConfig().general} />)
    fireEvent.click(screen.getByRole('button', { name: '跟随系统' }))
    expect(saveConfig).toHaveBeenCalledWith({ general: { theme: 'system' } })
  })
})
