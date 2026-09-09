import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubstrateService } from '@aiwc/protocol'
import { createDesktopReplySender } from './desktopReplySender'
import { createBackgroundAxInjector, createUiInjectSender } from '@aiwc/gateway'

vi.mock('@aiwc/gateway', () => ({
  createBackgroundAxInjector: vi.fn(() => ({ background: true })),
  createUiInjectSender: vi.fn(() => ({ send: vi.fn() })),
}))
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

describe('normal desktop startup on computer-use-reply', () => {
  it.each(['', 'foreground', 'background-ax'])('never enables global input regardless of the old mode flag (%s)', mode => {
    vi.stubEnv('AIWC_WECHAT_SEND_MODE', mode)
    createDesktopReplySender({ substrate: {} as SubstrateService, platform: 'darwin', nativeDir: '/app/native', dataRoot: '/user/data' })
    expect(createBackgroundAxInjector).toHaveBeenCalledWith({ helperPath: '/app/native/aiwc-background-helper', profilePath: '/user/data/background-reply/profile.json' })
    expect(createUiInjectSender).toHaveBeenCalledWith(expect.objectContaining({ injector: { background: true } }))
  })
  it('keeps unsupported platforms on the closed background path', () => {
    createDesktopReplySender({ substrate: {} as SubstrateService, platform: 'win32', nativeDir: '/native', dataRoot: '/data' })
    expect(createBackgroundAxInjector).toHaveBeenCalledWith(expect.objectContaining({ helperPath: undefined }))
    expect(createUiInjectSender).toHaveBeenCalledWith(expect.objectContaining({ injector: { background: true } }))
  })
})
