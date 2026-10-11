import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@/platform/hooks'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'
import { nextStepGate, hasKey } from './gating'

vi.mock('@/platform/hooks', () => ({ invoke: vi.fn() }))

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  __resetWizardStoreForTests()
  useWizardStore.setState({ wxid: 'old', dbRoot: '/root' })
})

it('rejects a selected account without matching keys and offers key recovery instead of entry', async () => {
  const error = 'No matching database key. Retrieve keys again for this account.'
  vi.mocked(invoke).mockResolvedValue({ ok: false, error })
  useWizardStore.setState({
    verifyState: 'verified',
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  useWizardStore.getState().selectWxid('new')
  expect(await useWizardStore.getState().verify()).toBe(false)
  expect(invoke).toHaveBeenCalledWith('substrate:verifyAccount', { wxid: 'new', dbRoot: '/root' })
  const state = useWizardStore.getState()
  expect(state).toMatchObject({
    verifyState: 'failed',
    verifyError: error,
    keys: { db_key: { status: 'failed', error } },
  })
  expect(
    nextStepGate({ ...state, verified: state.verifyState === 'verified', dbKeyPresent: hasKey(state.keys.db_key) }).ok,
  ).toBe(false)
})

it.each(['account', 'directory', 'key'] as const)('ignores verification after changing the %s', async (change) => {
  const result = Promise.withResolvers<{ ok: boolean }>()
  vi.mocked(invoke).mockReturnValue(result.promise)
  const pending = useWizardStore.getState().verify()
  switch (change) {
    case 'account':
      useWizardStore.getState().selectWxid('new')
      break
    case 'directory':
      useWizardStore.getState().setDbRoot('/new')
      break
    case 'key':
      useWizardStore.setState({
        keys: { ...useWizardStore.getState().keys, db_key: { status: 'missing' } },
        verifyState: 'idle',
      })
      break
  }
  result.resolve({ ok: true })
  expect(await pending).toBe(false)
  expect(useWizardStore.getState().verifyState).toBe('idle')
})

it('ignores an old failure after a newer verification succeeds', async () => {
  const result = Promise.withResolvers<{ ok: boolean; error?: string }>()
  vi.mocked(invoke).mockReturnValueOnce(result.promise).mockResolvedValueOnce({ ok: true })
  const pending = useWizardStore.getState().verify()
  expect(await useWizardStore.getState().verify()).toBe(true)
  result.resolve({ ok: false, error: 'stale failure' })
  expect(await pending).toBe(false)
  expect(useWizardStore.getState().verifyState).toBe('verified')
})

it('restores the database key status when retry verification succeeds', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ ok: false, error: 'key mismatch' }).mockResolvedValueOnce({ ok: true })
  expect(await useWizardStore.getState().verify()).toBe(false)
  expect(await useWizardStore.getState().verify()).toBe(true)
  expect(useWizardStore.getState()).toMatchObject({
    verifyState: 'verified',
    verifyError: undefined,
    keys: { db_key: { status: 'acquired' } },
  })
})

it('rejects keys displayed for another account even when the target has its own valid cached key', async () => {
  vi.mocked(invoke).mockResolvedValue({ ok: true })
  useWizardStore.setState({
    keyTarget: { wxid: 'old', dbRoot: '/root' },
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'acquired', source: 'cached' },
      image_aes: { status: 'missing' },
    },
  })
  useWizardStore.getState().selectWxid('new')
  expect(await useWizardStore.getState().verify()).toBe(false)
  expect(invoke).not.toHaveBeenCalled()
  expect(useWizardStore.getState()).toMatchObject({
    verifyState: 'failed',
    keys: { db_key: { status: 'failed' }, image_xor: { status: 'missing' } },
  })
})

it('requires verification for a previously verified account when the displayed keys belong to another one', () => {
  useWizardStore.setState({
    keyTarget: { wxid: 'old', dbRoot: '/root' },
    accounts: [{ wxid: 'new', dbRoot: '/root', verified: true }],
  })
  useWizardStore.getState().selectWxid('new')
  expect(useWizardStore.getState().verifyState).toBe('idle')
})

it('accepts a replacement database key for the selected account after an ownership mismatch', async () => {
  useWizardStore.setState({ keyTarget: { wxid: 'old', dbRoot: '/root' } })
  useWizardStore.getState().selectWxid('new')
  expect(await useWizardStore.getState().verify()).toBe(false)
  vi.mocked(invoke).mockResolvedValue({ ok: true })
  expect(await useWizardStore.getState().setManualKey('db_key', 'b'.repeat(64))).toEqual({ ok: true })
  expect(await useWizardStore.getState().verify()).toBe(true)
  expect(useWizardStore.getState().keyTarget).toEqual({ wxid: 'new', dbRoot: '/root' })
})
