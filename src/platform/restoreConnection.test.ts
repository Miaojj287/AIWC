import { afterEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type WechatCredentialStatus } from '@aiwc/protocol'
import { __setBridgeForTests } from './bridge'
import { restoreSavedConnection } from './restoreConnection'

const account = { ...defaultConfig().account, wxid: 'saved', dbRoot: '/saved' }
const available: WechatCredentialStatus = {
  database: true,
  imageXor: false,
  imageAes: false,
  matched: 2,
  total: 3,
  missing: ['message/message_1.db'],
  revision: 1,
}
afterEach(() => __setBridgeForTests(undefined))

it('restores an offline saved account even when image or one shard is unavailable, without process access', async () => {
  const invoke = vi.fn(async (channel: string) => (channel === 'substrate:credentialStatus' ? available : { ok: true }))
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  expect(await restoreSavedConnection(account)).toBe(true)
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['substrate:credentialStatus', 'substrate:connect'])
  expect(invoke).toHaveBeenCalledWith('substrate:connect', { wxid: 'saved', dbRoot: '/saved', cacheDir: undefined })
})

it.each(['missing', 'damaged', 'connection_failed'] as const)(
  'fails gracefully for %s cached access without trying another account',
  async (failure) => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'substrate:credentialStatus') {
        if (failure === 'damaged') throw new Error('locked store')
        return { ...available, database: failure !== 'missing' }
      }
      return { ok: false }
    })
    __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
    expect(await restoreSavedConnection(account)).toBe(false)
    expect(
      invoke.mock.calls.every(
        ([channel]) => channel === 'substrate:credentialStatus' || channel === 'substrate:connect',
      ),
    ).toBe(true)
  },
)
