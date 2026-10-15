import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { useConfigStore } from '@/platform/configStore'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

beforeEach(() => __resetWizardStoreForTests())
afterEach(() => {
  vi.restoreAllMocks()
  __setBridgeForTests(undefined)
})

it('tests the current draft and opens the data service, leaving completion to the wizard', async () => {
  const order: string[] = []
  const invoke = vi.fn(async (channel: string) => {
    order.push(channel)
    return { ok: true }
  })
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const save = vi.spyOn(useConfigStore.getState(), 'set').mockImplementation(async (patch) => {
    order.push(patch.onboarding ? 'complete' : 'save-account')
    return defaultConfig()
  })
  useWizardStore.setState({ wxid: 'current', dbRoot: '/current', cacheDir: '' })
  expect(await useWizardStore.getState().testAndFinish()).toBe(true)
  expect(invoke).toHaveBeenCalledWith('substrate:testConnection', { wxid: 'current', dbRoot: '/current' })
  expect(order).toEqual(['substrate:testConnection', 'substrate:connect'])
  expect(save).not.toHaveBeenCalled()
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
  useWizardStore.setState({ wxid: 'selected', dbRoot: '/selected' })
  expect(await useWizardStore.getState().setManualKey('image_aes', 'AbCdEfGh12345678')).toEqual({ ok: true })
  expect(invoke).toHaveBeenLastCalledWith('substrate:setManualKey', {
    kind: 'image_aes',
    hex: '41624364456647683132333435363738',
    target: { wxid: 'selected', dbRoot: '/selected' },
  })
  useWizardStore.setState({ verifyState: 'verified' })
  await useWizardStore.getState().setManualKey('db_key', 'a'.repeat(64))
  expect(useWizardStore.getState().verifyState).toBe('idle')
})

it('clearing a key deletes it from the selected account, so it stays missing after the next launch', async () => {
  const invoke = vi.fn(async () => undefined)
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({
    wxid: 'selected',
    dbRoot: '/selected',
    verifyState: 'verified',
    accounts: [{ wxid: 'selected', dbRoot: '/selected', verified: true }],
    credentials: {
      database: true,
      imageXor: true,
      imageAes: false,
      matched: 24,
      total: 25,
      missing: ['third_app_icon/third_app_icon.db'],
      revision: 1,
    },
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'acquired', source: 'cached' },
      image_aes: { status: 'missing' },
    },
  })
  await useWizardStore.getState().clearKey('db_key')
  expect(invoke).toHaveBeenCalledWith('substrate:clearKey', {
    kind: 'db_key',
    target: { wxid: 'selected', dbRoot: '/selected' },
  })
  expect(useWizardStore.getState()).toMatchObject({
    keys: { db_key: { status: 'missing' }, image_xor: { status: 'acquired' } },
    verifyState: 'idle',
    accounts: [{ wxid: 'selected', verified: false }],
    credentials: { database: false, imageXor: true, matched: 0, total: 0, missing: [], revision: 2 },
  })
})

it('keeps showing the key when deleting it fails', async () => {
  const invoke = vi.fn(async () => {
    throw new Error('store locked')
  })
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({
    keys: {
      db_key: { status: 'missing' },
      image_xor: { status: 'acquired', source: 'cached' },
      image_aes: { status: 'missing' },
    },
  })
  await expect(useWizardStore.getState().clearKey('image_xor')).rejects.toThrow('store locked')
  expect(invoke).toHaveBeenCalledWith('substrate:clearKey', { kind: 'image_xor' })
  expect(useWizardStore.getState().keys.image_xor).toEqual({ status: 'acquired', source: 'cached' })
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
  expect(useWizardStore.getState()).toMatchObject({
    dbRoot: '/detected',
    dbRootSource: 'auto',
    wxid: 'only',
    detecting: false,
  })
})

it('keeps the saved directory instead of replacing it with automatic detection', async () => {
  const invoke = vi.fn(async (channel: string) => (channel === 'substrate:listAccounts' ? [] : {}))
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  await useWizardStore
    .getState()
    .hydrate({ ...defaultConfig(), account: { ...defaultConfig().account, dbRoot: '/saved' } })
  expect(useWizardStore.getState().dbRoot).toBe('/saved')
  expect(invoke).not.toHaveBeenCalledWith('substrate:detectWeChat', undefined)
})

it('verifies and connects a cached account when the user retries entry', async () => {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'substrate:status'
      ? { connection: 'ready', sync: {}, account: { wxid: 'me', dbRoot: '/root', verified: true } }
      : { ok: true },
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({
    wxid: 'me',
    dbRoot: '/root',
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  expect(await useWizardStore.getState().enter()).toBe(true)
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['substrate:testConnection', 'substrate:connect'])
})

it('runs the full connection test on 进入 after a key was replaced on the page', async () => {
  const invoke = vi.fn(async () => ({ ok: true }))
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  vi.spyOn(useConfigStore.getState(), 'set').mockResolvedValue(defaultConfig())
  useWizardStore.setState({
    wxid: 'me',
    dbRoot: '/root',
    keys: {
      db_key: { status: 'manual', hex: 'a'.repeat(64) },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  expect(await useWizardStore.getState().enter()).toBe(true)
  expect(invoke).toHaveBeenCalledWith('substrate:testConnection', { wxid: 'me', dbRoot: '/root' })
  expect(invoke).not.toHaveBeenCalledWith('substrate:status', undefined)
})
