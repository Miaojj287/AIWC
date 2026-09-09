import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { useConfigStore } from '@/platform/configStore'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

beforeEach(() => __resetWizardStoreForTests())
afterEach(() => { vi.restoreAllMocks(); __setBridgeForTests(undefined) })

it('tests the current draft and opens the data service before completing onboarding', async () => {
  const order: string[] = []
  const invoke = vi.fn(async (channel: string) => { order.push(channel); return { ok: true } })
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const save = vi.spyOn(useConfigStore.getState(), 'set').mockImplementation(async (patch) => {
    order.push(patch.onboarding ? 'complete' : 'save-account')
    return defaultConfig()
  })
  useWizardStore.setState({ wxid: 'current', dbRoot: '/current', cacheDir: '' })
  expect(await useWizardStore.getState().testAndFinish()).toBe(true)
  expect(invoke).toHaveBeenCalledWith('substrate:testConnection', { wxid: 'current', dbRoot: '/current' })
  expect(order).toEqual(['substrate:testConnection', 'save-account', 'substrate:connect', 'complete'])
  expect(save).toHaveBeenLastCalledWith({ onboarding: { completed: true } })
})

it('does not complete onboarding when opening the database fails', async () => {
  const invoke = vi.fn(async (channel: string) => ({ ok: channel !== 'substrate:connect', error: '连接失败' }))
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const save = vi.spyOn(useConfigStore.getState(), 'set').mockResolvedValue(defaultConfig())
  useWizardStore.setState({ wxid: 'current', dbRoot: '/current' })
  expect(await useWizardStore.getState().testAndFinish()).toBe(false)
  expect(save).not.toHaveBeenCalledWith({ onboarding: { completed: true } })
  expect(useWizardStore.getState().testError).toBe('连接失败')
})

it('keeps AES case intact and invalidates account verification when replacing the database key', async () => {
  const invoke = vi.fn(async () => ({ ok: true }))
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  expect(await useWizardStore.getState().setManualKey('image_aes', 'AbCdEfGh12345678')).toEqual({ ok: true })
  expect(invoke).toHaveBeenLastCalledWith('substrate:setManualKey', { kind: 'image_aes', hex: '41624364456647683132333435363738' })
  useWizardStore.setState({ verifyState: 'verified' })
  await useWizardStore.getState().setManualKey('db_key', 'a'.repeat(64))
  expect(useWizardStore.getState().verifyState).toBe('idle')
})

it('automatically detects the data directory during hydration even when WeChat is not running', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'app:getInfo') return { dataDir: '/app' }
    if (channel === 'substrate:detectWeChat') return { running: false, dbRoot: '/detected' }
    if (channel === 'substrate:listAccounts') return [{ wxid: 'only', dbRoot: '/detected', verified: false }]
    return false
  })
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  await useWizardStore.getState().hydrate(defaultConfig())
  expect(useWizardStore.getState()).toMatchObject({ dbRoot: '/detected', dbRootSource: 'auto', wxid: 'only', detecting: false })
})

it('keeps the saved directory instead of replacing it with automatic detection', async () => {
  const invoke = vi.fn(async (channel: string) => channel === 'substrate:listAccounts' ? [] : {})
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  await useWizardStore.getState().hydrate({ ...defaultConfig(), account: { dbRoot: '/saved' } })
  expect(useWizardStore.getState().dbRoot).toBe('/saved')
  expect(invoke).not.toHaveBeenCalledWith('substrate:detectWeChat', undefined)
})
