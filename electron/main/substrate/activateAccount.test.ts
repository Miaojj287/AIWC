import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type AppConfig, type WxAccount } from '@aiwc/protocol'
import { createAccountActivator } from './activateAccount'
import type { AppContext } from '../contracts'

function setup(saved = 'a', connected = 'a', fail = false) {
  let value: AppConfig = { ...defaultConfig(), account: { wxid: saved, dbRoot: '/root', verifiedAt: 1 } }
  let account: WxAccount = { wxid: connected, dbRoot: '/root', verified: true, avatarPath: `${connected}.png` }
  const opened: string[] = []
  const config = {
    get: () => value,
    set: (patch: { account: Partial<AppConfig['account']> }) => { value = { ...value, account: { ...value.account, ...patch.account } }; return value },
    replace: (next: AppConfig) => { value = next; return value },
  }
  const status = () => ({ connection: 'ready', sync: { phase: 'idle' }, account })
  const substrate = {
    status, refreshStatus: async () => status(),
    reconnect: vi.fn(async () => {
      opened.push(value.account.wxid!)
      if (fail && value.account.wxid === 'b') return { ok: false, error: 'wrong key' }
      account = { wxid: value.account.wxid!, dbRoot: '/root', verified: true, avatarPath: `${value.account.wxid}.png` }
      return { ok: true }
    }),
  }
  const activate = createAccountActivator({ config, substrate } as unknown as AppContext)
  return { config, substrate, activate, opened }
}

describe('main-process account activation', () => {
  it('repairs saved B / connected A, even when B is selected again', async () => {
    const s = setup('b', 'a')
    expect(await s.activate({ wxid: 'b', dbRoot: '/root' })).toEqual({ ok: true })
    expect(s.opened).toEqual(['b'])
    expect(s.substrate.status().account).toMatchObject({ wxid: 'b', avatarPath: 'b.png' })
    expect(s.config.get().account.verifiedAt).toBeGreaterThan(1)
  })
  it('restores the actually connected A instead of the stale saved B on failure', async () => {
    const s = setup('b', 'a', true)
    expect(await s.activate({ wxid: 'b', dbRoot: '/root' })).toMatchObject({ ok: false })
    expect(s.opened).toEqual(['b', 'a'])
    expect(s.config.get().account.wxid).toBe('a')
  })
  it('serializes rapid account selections', async () => {
    const s = setup()
    const results = await Promise.all([s.activate({ wxid: 'b', dbRoot: '/root' }), s.activate({ wxid: 'c', dbRoot: '/root' })])
    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(s.opened).toEqual(['b', 'c'])
    expect(s.substrate.status().account.wxid).toBe('c')
  })
  it('rejects a successful reconnect that still reports the old identity', async () => {
    const s = setup()
    s.substrate.reconnect.mockImplementation(async () => ({ ok: true }))
    expect(await s.activate({ wxid: 'b', dbRoot: '/root' })).toMatchObject({ ok: false, error: '实际连接账号与所选账号不一致' })
    expect(s.config.get().account.wxid).toBe('a')
  })
})
