// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, type AiwcBridge, type AppConfig } from '@aiwc/protocol'
import { __setBridgeForTests } from './bridge'
import { __resetConfigStoreForTests, applyTheme, resolveTheme, useConfigStore } from './configStore'

function fakeBridge(initial: AppConfig, failSet = false): AiwcBridge & { calls: string[] } {
  let current = initial
  const calls: string[] = []
  return {
    runtime: 'web',
    platform: 'darwin',
    calls,
    on: () => () => {},
    invoke: (async (channel: string, req: unknown) => {
      calls.push(channel)
      if (channel === 'config:get') return current
      if (channel === 'config:set') {
        if (failSet) throw new Error('disk full')
        const patch = req as Partial<AppConfig>
        current = { ...current, ...patch, general: { ...current.general, ...(patch.general ?? {}) } }
        return current
      }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

describe('configStore', () => {
  beforeEach(() => {
    __resetConfigStoreForTests()
    delete document.documentElement.dataset.theme
  })
  afterEach(() => __setBridgeForTests(undefined))

  it('hydrates from config:get and applies the theme', async () => {
    __setBridgeForTests(fakeBridge({ ...defaultConfig(), general: { ...defaultConfig().general, theme: 'light' } }))
    const cfg = await useConfigStore.getState().hydrate()
    expect(cfg.general.theme).toBe('light')
    expect(useConfigStore.getState().hydrated).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies patches optimistically and reconciles', async () => {
    const bridge = fakeBridge(defaultConfig())
    __setBridgeForTests(bridge)
    await useConfigStore.getState().hydrate()
    expect(document.documentElement.dataset.theme).toBe('dark')
    const promise = useConfigStore.getState().set({ general: { theme: 'light' } })
    expect(useConfigStore.getState().config?.general.theme).toBe('light') // optimistic
    expect(document.documentElement.dataset.theme).toBe('light')
    const confirmed = await promise
    expect(confirmed.general.theme).toBe('light')
    expect(bridge.calls).toEqual(['config:get', 'config:set'])
  })

  it('rolls back when config:set fails', async () => {
    __setBridgeForTests(fakeBridge(defaultConfig(), true))
    await useConfigStore.getState().hydrate()
    await expect(useConfigStore.getState().set({ general: { theme: 'light' } })).rejects.toThrow('disk full')
    expect(useConfigStore.getState().config?.general.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('resolves system theme without matchMedia', () => {
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
    expect(['dark', 'light']).toContain(resolveTheme('system'))
    expect(applyTheme('system')).toBe(document.documentElement.dataset.theme)
  })
})
