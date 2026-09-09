import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type InvokeChannel, type InvokeReq, type InvokeRes } from '@aiwc/protocol'
import { verifyAccount } from '@aiwc/substrate'
import type { AppContext } from '../contracts'
import type { Handle, Handler, HostBridge } from './register'
import { registerSubstrateIpc } from './substrate'

vi.mock('@aiwc/substrate', () => ({ acquireKeys: vi.fn(), detectWeChat: vi.fn(), listAccounts: vi.fn(), verifyAccount: vi.fn().mockResolvedValue({ ok: true }) }))

function setup() {
  const config = { ...defaultConfig(), account: { wxid: 'old', dbRoot: '/old', dbKeyRef: 'account:dbKey' } }
  const secrets = { set: vi.fn(), reveal: vi.fn(() => 'a'.repeat(64)) }
  const set = vi.fn()
  const logger = { child: () => logger }
  const handlers = new Map<string, Handler<never>>()
  const handle: Handle = (channel, fn) => { handlers.set(channel, fn as Handler<never>) }
  registerSubstrateIpc({ logger, config: { get: () => config, set }, secrets, substrate: {} } as unknown as AppContext, {} as HostBridge, handle)
  const invoke = <K extends InvokeChannel>(channel: K, req: InvokeReq<K>): InvokeRes<K> => (handlers.get(channel) as unknown as (req: InvokeReq<K>) => InvokeRes<K>)(req)
  return { secrets, invoke }
}

describe('manual WeChat key IPC', () => {
  it.each([
    ['db_key', ` 0x${'AB '.repeat(32)} `, 'ab'.repeat(32)],
    ['image_xor', '0x53', '53'],
    ['image_aes', 'AbCdEfGh12345678', '41624364456647683132333435363738'],
    ['image_aes', `0x${'AB'.repeat(16)}`, 'ab'.repeat(16)],
  ] as const)('accepts and normalizes %s with its own format', (kind, hex, expected) => {
    const { invoke, secrets } = setup()
    expect(invoke('substrate:setManualKey', { kind, hex })).toEqual({ ok: true })
    expect(secrets.set).toHaveBeenCalledWith(expect.any(String), expected)
  })
  it('never saves malformed keys', () => {
    const { invoke, secrets } = setup()
    expect(invoke('substrate:setManualKey', { kind: 'image_xor', hex: 'a'.repeat(64) }).ok).toBe(false)
    expect(secrets.set).not.toHaveBeenCalled()
  })
  it('tests the explicitly selected account instead of the previously saved account', async () => {
    const { invoke } = setup()
    await invoke('substrate:testConnection', { wxid: 'new', dbRoot: '/new' })
    expect(verifyAccount).toHaveBeenLastCalledWith({ wxid: 'new', dbRoot: '/new', dbKeyHex: 'a'.repeat(64) })
  })
})
