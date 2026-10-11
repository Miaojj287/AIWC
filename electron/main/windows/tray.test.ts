import { describe, expect, it, vi } from 'vitest'
import { createTrayController, needsTray, trayMenuTemplate, type TrayHandle } from './tray'

function fakeTray() {
  const listeners = new Map<string, () => void>()
  const handle: TrayHandle = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn((event, listener) => void listeners.set(event, listener)),
    destroy: vi.fn(),
  }
  return { handle, listeners }
}

describe('tray', () => {
  it('is only needed where a hidden window would otherwise be unreachable', () => {
    expect(needsTray('win32')).toBe(true)
    expect(needsTray('linux')).toBe(true)
    expect(needsTray('darwin')).toBe(false)
  })

  it('offers show and quit', () => {
    const show = vi.fn()
    const quit = vi.fn()
    const template = trayMenuTemplate({ show: '显示 AIWC', quit: '退出' }, { show, quit })
    expect(template.map((item) => item.label ?? item.type)).toEqual(['显示 AIWC', 'separator', '退出'])
    template[0]?.click?.({} as never, undefined as never, {} as never)
    template[2]?.click?.({} as never, undefined as never, {} as never)
    expect(show).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('creates the icon once on Windows, restores the window on click and rebuilds labels on refresh', () => {
    const { handle, listeners } = fakeTray()
    const createTray = vi.fn(() => handle)
    const show = vi.fn()
    let language = 'zh'
    const controller = createTrayController({
      platform: 'win32',
      tooltip: 'AIWC',
      labels: () => (language === 'zh' ? { show: '显示 AIWC', quit: '退出' } : { show: 'Show AIWC', quit: 'Quit' }),
      show,
      quit: vi.fn(),
      createTray,
      buildMenu: (template) => template,
    })
    controller.ensure()
    controller.ensure()
    expect(createTray).toHaveBeenCalledOnce()
    expect(handle.setToolTip).toHaveBeenCalledWith('AIWC')
    listeners.get('click')?.()
    expect(show).toHaveBeenCalledOnce()
    language = 'en'
    controller.refresh()
    const lastMenu = vi.mocked(handle.setContextMenu).mock.calls.at(-1)?.[0] as Array<{ label?: string }>
    expect(lastMenu[0]?.label).toBe('Show AIWC')
    controller.dispose()
    expect(handle.destroy).toHaveBeenCalledOnce()
  })

  it('never creates a status item on macOS: the Dock icon already brings the window back', () => {
    const createTray = vi.fn()
    const controller = createTrayController({
      platform: 'darwin',
      tooltip: 'AIWC',
      labels: () => ({ show: '', quit: '' }),
      show: vi.fn(),
      quit: vi.fn(),
      createTray,
      buildMenu: (template) => template,
    })
    controller.ensure()
    expect(createTray).not.toHaveBeenCalled()
  })
})
