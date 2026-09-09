import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { useConfigStore, __resetConfigStoreForTests } from '@/platform/configStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { activateAccount } from './hooks'

vi.mock('@/kit', () => ({ toast: { error: vi.fn() } }))

beforeEach(() => {
  __resetConfigStoreForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {} })
})
afterEach(() => { __setBridgeForTests(undefined) })

function setup(results: { ok: boolean; error?: string }[]) {
  let config = { ...defaultConfig(), account: { wxid: 'old', dbRoot: '/old', verifiedAt: 1 } }
  useConfigStore.setState({ config, hydrated: true })
  const connected: string[] = []
  const invoke = vi.fn(async (channel: string, req: unknown) => {
    if (channel === 'config:get') return config
    if (channel === 'substrate:status') return { connection: 'ready', account: config.account }
    if (channel === 'substrate:connect') {
      const target = req as { wxid: string; dbRoot: string }
      connected.push(target.wxid)
      const result = results.shift()
      if (result?.ok) config = { ...config, account: { ...config.account, ...target } }
      return result
    }
    throw new Error(channel)
  })
  __setBridgeForTests({ runtime: 'web', platform: 'darwin', invoke, on: () => () => {} } as AiwcBridge)
  useTabsStore.getState().open({ kind: 'chat', objectId: 'friend', title: '旧会话' })
  useTabsStore.getState().open({ kind: 'settings', objectId: 'settings', title: '设置' })
  return connected
}

describe('account switch', () => {
  it('reopens the selected database and discards old chat tabs only after success', async () => {
    const connected = setup([{ ok: true }])
    expect(await activateAccount({ wxid: 'new', dbRoot: '/new', verifiedAt: 0 })).toBe(true)
    expect(connected).toEqual(['new'])
    expect(useConfigStore.getState().config?.account.wxid).toBe('new')
    expect(useTabsStore.getState().tabs.map((t) => t.kind)).toEqual(['settings'])
    expect(useTabsStore.getState().recentlyClosed).toEqual([])
  })
  it('restores the previous database and preserves tabs when connecting fails', async () => {
    const connected = setup([{ ok: false, error: 'wrong key' }, { ok: true }])
    expect(await activateAccount({ wxid: 'new', dbRoot: '/new', verifiedAt: 0 })).toBe(false)
    expect(connected).toEqual(['new'])
    expect(useConfigStore.getState().config?.account.wxid).toBe('old')
    expect(useTabsStore.getState().tabs.map((t) => t.kind)).toEqual(['chat', 'settings'])
  })
})
