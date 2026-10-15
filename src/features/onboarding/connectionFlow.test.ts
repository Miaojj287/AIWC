import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type KeyAcquireStep, type WechatCredentialStatus } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

const available: WechatCredentialStatus = {
  database: true,
  imageXor: false,
  imageAes: false,
  matched: 2,
  total: 3,
  missing: ['message/message_1.db'],
  revision: 1,
}
const missing: WechatCredentialStatus = { ...available, database: false, matched: 0, missing: [], revision: 0 }
const success: KeyAcquireStep[] = [
  { id: 'db_key', label: '', status: 'done' },
  { id: 'verify', label: '', status: 'done' },
]

beforeEach(() => __resetWizardStoreForTests())
afterEach(() => __setBridgeForTests(undefined))

it('loads selected account capabilities without revealing any saved key', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'substrate:credentialStatus') return available
    if (channel === 'substrate:listAccounts') return [{ wxid: 'selected', dbRoot: '/saved', verified: true }]
    return { dataDir: '/app' }
  })
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  await useWizardStore
    .getState()
    .hydrate({ ...defaultConfig(), account: { ...defaultConfig().account, wxid: 'selected', dbRoot: '/saved' } })
  expect(invoke).toHaveBeenCalledWith('substrate:credentialStatus', { wxid: 'selected', dbRoot: '/saved' })
  expect(invoke.mock.calls.some(([channel]) => channel.startsWith('secret:'))).toBe(false)
  expect(useWizardStore.getState()).toMatchObject({ credentials: available, verifyState: 'verified' })
})

it('does not restore old coverage when a capability check finishes after database credentials were cleared', async () => {
  const result = Promise.withResolvers<WechatCredentialStatus>()
  const invoke = vi.fn((channel: string) =>
    channel === 'substrate:credentialStatus' ? result.promise : Promise.resolve(undefined),
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({
    wxid: 'selected',
    dbRoot: '/root',
    credentials: available,
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  const pending = useWizardStore.getState().loadCredentials()
  await useWizardStore.getState().clearKey('db_key')
  result.resolve(available)
  await pending
  expect(useWizardStore.getState()).toMatchObject({
    credentialsLoading: false,
    verifyState: 'idle',
    keys: { db_key: { status: 'missing' } },
    credentials: { database: false, matched: 0, total: 0, missing: [] },
  })
})

it('refreshes capabilities and discards an acquire result after account changes away and back', async () => {
  const result = Promise.withResolvers<KeyAcquireStep[]>()
  const invoke = vi.fn((channel: string) =>
    channel === 'substrate:acquireKeys' ? result.promise : Promise.resolve(missing),
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({ wxid: 'first', dbRoot: '/root' })
  const pending = useWizardStore.getState().acquire('auto', 'database')
  await Promise.resolve()
  useWizardStore.getState().selectWxid('second')
  useWizardStore.getState().selectWxid('first')
  result.resolve(success)
  await pending
  expect(invoke).toHaveBeenCalledWith('substrate:credentialStatus', { wxid: 'second', dbRoot: '/root' })
  expect(useWizardStore.getState()).toMatchObject({
    wxid: 'first',
    acquiring: false,
    verifyState: 'idle',
    keys: { db_key: { status: 'missing' } },
  })
})

it('makes image recovery an image-only operation and preserves database access', async () => {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'substrate:credentialStatus'
      ? available
      : [
          { id: 'image_xor', label: '', status: 'done' },
          { id: 'image_aes', label: '', status: 'failed', failure: 'timeout' },
        ],
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({
    wxid: 'selected',
    dbRoot: '/root',
    credentials: available,
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  await useWizardStore.getState().acquire('memory_scan', 'image')
  expect(invoke).toHaveBeenCalledWith('substrate:acquireKeys', {
    wxid: 'selected',
    dbRoot: '/root',
    strategy: 'memory_scan',
    scope: 'image',
  })
  expect(useWizardStore.getState().keys.db_key.status).toBe('acquired')
  expect(useWizardStore.getState().acquireSteps.map((step) => step.id)).toEqual(['image_xor', 'image_aes'])
})

it('connects in one user action after acquiring database access without waiting for image keys', async () => {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'substrate:acquireKeys' ? success : channel === 'substrate:credentialStatus' ? available : { ok: true },
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({ wxid: 'selected', dbRoot: '/root' })
  expect(await useWizardStore.getState().connect()).toBe(true)
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
    'substrate:acquireKeys',
    'substrate:credentialStatus',
    'substrate:testConnection',
    'substrate:connect',
  ])
  expect(invoke).toHaveBeenCalledWith('substrate:acquireKeys', {
    wxid: 'selected',
    dbRoot: '/root',
    strategy: 'auto',
    scope: 'database',
  })
})

it('keeps saved account identity when its directory no longer contains it', async () => {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'substrate:listAccounts'
      ? [{ wxid: 'other', dbRoot: '/saved', verified: true }]
      : channel === 'substrate:credentialStatus'
        ? missing
        : {},
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  await useWizardStore.getState().hydrate({
    ...defaultConfig(),
    onboarding: { completed: true },
    account: { ...defaultConfig().account, wxid: 'saved', dbRoot: '/saved' },
  })
  expect(useWizardStore.getState().wxid).toBe('saved')
  expect(useWizardStore.getState().verifyState).toBe('idle')
})

it.each(['timeout', 'needs_authorization'] as const)(
  'keeps %s visible without attempting a connection or reading images',
  async (failure) => {
    const invoke = vi.fn(async () => [
      { id: 'db_key', label: '', status: 'failed', failure },
      { id: 'verify', label: '', status: 'failed', failure: 'skipped' },
    ])
    __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
    useWizardStore.setState({ wxid: 'selected', dbRoot: '/root' })
    expect(await useWizardStore.getState().connect()).toBe(false)
    expect(useWizardStore.getState()).toMatchObject({ acquireFailed: true, acquiring: false })
    expect(useWizardStore.getState().acquireSteps[0]?.failure).toBe(failure)
    expect(invoke).toHaveBeenCalledTimes(1)
  },
)

it('does not resume a forced recovery on a newly selected account', async () => {
  const result = Promise.withResolvers<KeyAcquireStep[]>()
  const invoke = vi.fn((channel: string) =>
    channel === 'substrate:acquireKeys' ? result.promise : Promise.resolve(missing),
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({ wxid: 'first', dbRoot: '/root' })
  const pending = useWizardStore.getState().connect(true)
  await Promise.resolve()
  useWizardStore.getState().selectWxid('second')
  result.resolve(success)
  expect(await pending).toBe(false)
  expect(invoke.mock.calls.filter(([channel]) => channel === 'substrate:acquireKeys')).toHaveLength(1)
  expect(invoke.mock.calls.some(([channel]) => channel === 'substrate:connect')).toBe(false)
})

it('does not open cached data when a forced recovery is cancelled', async () => {
  const result = Promise.withResolvers<KeyAcquireStep[]>()
  const invoke = vi.fn((channel: string) =>
    channel === 'substrate:acquireKeys' ? result.promise : Promise.resolve(missing),
  )
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useWizardStore.setState({
    wxid: 'saved',
    dbRoot: '/root',
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  const pending = useWizardStore.getState().connect(true)
  await Promise.resolve()
  useWizardStore.getState().cancelAcquire()
  result.resolve(success)
  expect(await pending).toBe(false)
  expect(invoke.mock.calls.some(([channel]) => channel === 'substrate:connect')).toBe(false)
})
