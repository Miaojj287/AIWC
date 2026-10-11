import { describe, expect, it, vi } from 'vitest'
import { applyLoginItem } from './loginItem'

describe('launch at login', () => {
  it('writes the OS login item for a packaged build on macOS and Windows', () => {
    const target = { isPackaged: true, setLoginItemSettings: vi.fn() }
    expect(applyLoginItem(target, 'darwin', true)).toBe(true)
    expect(applyLoginItem(target, 'win32', false)).toBe(true)
    expect(target.setLoginItemSettings.mock.calls).toEqual([[{ openAtLogin: true }], [{ openAtLogin: false }]])
  })

  it('never registers a development run or an unsupported platform', () => {
    const dev = { isPackaged: false, setLoginItemSettings: vi.fn() }
    expect(applyLoginItem(dev, 'darwin', true)).toBe(false)
    const linux = { isPackaged: true, setLoginItemSettings: vi.fn() }
    expect(applyLoginItem(linux, 'linux', true)).toBe(false)
    expect(dev.setLoginItemSettings).not.toHaveBeenCalled()
    expect(linux.setLoginItemSettings).not.toHaveBeenCalled()
  })
})
