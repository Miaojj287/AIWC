import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultConfig,
  type InvokeChannel,
  type InvokeReq,
  type InvokeRes,
  type ListMessagesQuery,
  type WxMessage,
} from '@aiwc/protocol'
import { acquireKeys, verifyAccount } from '@aiwc/substrate'
import type { AppContext } from '../contracts'
import type { HostBridge } from './register'
import { registerSubstrateIpc } from './substrate'
import { createHandlerHarness } from './testing/handlerHarness'
import { setMainLanguage, t } from '../i18n'
import { createConfigService } from '../config/configService'
import { createSecretStore, SECRET_REFS } from '../config/secretStore'

vi.mock('@aiwc/substrate', () => ({
  acquireKeys: vi.fn(),
  findWeChatPidSync: vi.fn(() => null),
  scanMacDbKey: vi.fn(),
  scanMacDbKeyFromDumps: vi.fn(),
  detectWeChat: vi.fn(),
  listAccounts: vi.fn(),
  verifyAccount: vi.fn().mockResolvedValue({ ok: true }),
}))

function setup(accountSession?: HostBridge['accountSession']) {
  const config = { ...defaultConfig(), account: { wxid: 'old', dbRoot: '/old', dbKeyRef: 'account:dbKey' } }
  const secrets = { set: vi.fn(), reveal: vi.fn((): string | undefined => 'a'.repeat(64)), delete: vi.fn() }
  const set = vi.fn()
  const logger = { child: () => logger }
  const ipc = createHandlerHarness()
  registerSubstrateIpc(
    { logger, config: { get: () => config, set }, secrets, substrate: {}, paths: {} } as unknown as AppContext,
    { accountSession } as HostBridge,
    ipc.handle,
  )
  // setManualKey answers synchronously; the tests read its result without awaiting.
  const invoke = <K extends InvokeChannel>(channel: K, req: InvokeReq<K>) => ipc.invoke(channel, req) as InvokeRes<K>
  return { secrets, set, invoke, invokeRaw: ipc.invokeRaw }
}

describe('clearing a saved WeChat key', () => {
  it('deletes the key under both its conventional and its configured ref, and drops verification for the database key', () => {
    const { invoke, secrets, set } = setup()
    invoke('substrate:clearKey', { kind: 'db_key' })
    expect(secrets.delete).toHaveBeenCalledWith('account.dbKey')
    expect(secrets.delete).toHaveBeenCalledWith('account:dbKey')
    expect(set).toHaveBeenCalledWith({ account: { verifiedAt: 0 } })
  })
  it('keeps the account verified when only an image key is cleared', () => {
    const { invoke, secrets, set } = setup()
    invoke('substrate:clearKey', { kind: 'image_aes' })
    expect(secrets.delete).toHaveBeenCalledWith('account.imageAesKey')
    expect(set).not.toHaveBeenCalled()
  })
  it('refuses anything that is not one of the three WeChat keys', () => {
    const { invokeRaw, secrets } = setup()
    expect(() => invokeRaw('substrate:clearKey', { kind: 'toString' })).toThrow()
    expect(() => invokeRaw('substrate:clearKey', { kind: 'db_key', target: { wxid: '..', dbRoot: '/x' } })).toThrow()
    expect(secrets.delete).not.toHaveBeenCalled()
  })
})

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

describe('account verification IPC', () => {
  it.each([false, true])('uses only the selected account credentials (saved key: %s)', async (hasSavedKey) => {
    const root = mkdtempSync(join(tmpdir(), 'aiwc-verify-account-'))
    try {
      const config = createConfigService({ file: join(root, 'config.json') })
      const secrets = createSecretStore({
        file: join(root, 'secrets.bin'),
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
        },
      })
      config.set({ account: { wxid: 'new', dbRoot: '/new', dbKeyRef: SECRET_REFS.dbKey } })
      if (hasSavedKey) secrets.set(SECRET_REFS.dbKey, 'b'.repeat(64))
      const credentials = vi.fn(() => ({ config, secrets }))
      const current = setup({ credentials, switch: vi.fn(), isSwitching: () => false })
      vi.mocked(verifyAccount).mockClear()
      const result = await current.invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
      expect(credentials).toHaveBeenCalledWith({ wxid: 'new', dbRoot: '/new' })
      expect(current.secrets.reveal).not.toHaveBeenCalled()
      expect(result.ok).toBe(hasSavedKey)
      if (hasSavedKey)
        expect(verifyAccount).toHaveBeenCalledWith({ wxid: 'new', dbRoot: '/new', dbKeyHex: 'b'.repeat(64) })
      else expect(verifyAccount).not.toHaveBeenCalled()
      expect(secrets.has(SECRET_REFS.dbKey)).toBe(hasSavedKey)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects verification without a saved database key instead of accepting directory-only validation', async () => {
    const { invoke, secrets } = setup()
    secrets.reveal.mockReturnValueOnce(undefined)
    vi.mocked(verifyAccount).mockClear()
    const result = await invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
    expect(result).toEqual({ ok: false, error: t('main.substrate.accountKeyMissing') })
    expect(verifyAccount).not.toHaveBeenCalled()
  })

  it('guides the user to reacquire the key when database verification fails', async () => {
    const { invoke } = setup()
    vi.mocked(verifyAccount).mockResolvedValueOnce({ ok: false, error: '密钥与数据库不匹配' })
    const result = await invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('重新获取')
  })

  it('localizes both the mismatch and recovery guidance in English', async () => {
    setMainLanguage('en-US')
    try {
      const { invoke } = setup()
      vi.mocked(verifyAccount).mockResolvedValueOnce({ ok: false, error: '密钥与数据库不匹配' })
      const result = await invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
      expect(result.error).toContain('Retrieve keys again')
      expect(result.error).not.toMatch(/[\u4e00-\u9fff]/)
    } finally {
      setMainLanguage('zh-CN')
    }
  })
})

describe('key acquisition IPC', () => {
  function acquireSetup() {
    const secrets = { set: vi.fn(), reveal: vi.fn() }
    const toast = vi.fn()
    const logger = { child: () => logger, warn: vi.fn() }
    const ipc = createHandlerHarness()
    registerSubstrateIpc(
      {
        logger,
        config: { get: () => defaultConfig(), set: vi.fn() },
        secrets,
        substrate: {},
        paths: { nativeDir: '/native' },
        broadcast: vi.fn(),
        toast,
      } as unknown as AppContext,
      {} as HostBridge,
      ipc.handle,
    )
    return { ipc, secrets, toast }
  }
  // A run that only ends when its signal aborts, like a login hook waiting for the user.
  const waitForAbort = async (opts: { signal?: AbortSignal }) => {
    await new Promise<void>((resolve) => opts.signal?.addEventListener('abort', () => resolve(), { once: true }))
    return { steps: [], cancelled: true, dbKeyHex: 'a'.repeat(64) }
  }

  it('cancel aborts the running acquisition, which then stores nothing and toasts nothing', async () => {
    vi.mocked(acquireKeys).mockImplementation(waitForAbort)
    const { ipc, secrets, toast } = acquireSetup()
    const run = ipc.invoke('substrate:acquireKeys', { wxid: 'wxid_a', dbRoot: '/root' })
    await Promise.resolve()
    await ipc.invoke('substrate:cancelAcquireKeys', undefined)
    await expect(run).resolves.toEqual([])
    expect(secrets.set).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('a new request supersedes the running one instead of running two at once', async () => {
    const signals: AbortSignal[] = []
    vi.mocked(acquireKeys).mockImplementation(async (opts) => {
      if (opts.signal) signals.push(opts.signal)
      return signals.length === 1 ? waitForAbort(opts) : { steps: [] }
    })
    const { ipc } = acquireSetup()
    const first = ipc.invoke('substrate:acquireKeys', { wxid: 'wxid_a', dbRoot: '/root' })
    await Promise.resolve()
    await ipc.invoke('substrate:acquireKeys', { wxid: 'wxid_a', dbRoot: '/root' })
    await first
    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })
})

describe('session export IPC', () => {
  const message = (seq: number, senderId: string): WxMessage => ({
    id: `m${seq}`,
    sessionId: 'room@chatroom',
    seq,
    createdAt: Date.UTC(2026, 8, 6, 2, 0, seq),
    senderId,
    senderName: senderId,
    isSelf: false,
    kind: 'text',
    text: `text from ${senderId}`,
    anchor: { sessionId: 'room@chatroom', messageId: `m${seq}`, seq, createdAt: 0 },
  })

  function exportSetup() {
    const exportsDir = mkdtempSync(join(tmpdir(), 'aiwc-export-ipc-'))
    const history = [message(1, 'wxid_kept'), message(2, 'wxid_hidden'), message(3, 'wxid_kept')]
    // Ignores senderIds on purpose: the handler must enforce the filter itself.
    const listMessages = vi.fn(async (q: ListMessagesQuery) => ({
      items: history.filter((m) => m.seq > (q.afterSeq ?? 0)),
      hasMore: false,
    }))
    const logger = { child: () => logger, warn: vi.fn(), debug: vi.fn() }
    const ipc = createHandlerHarness()
    registerSubstrateIpc(
      {
        logger,
        config: { get: () => defaultConfig(), set: vi.fn() },
        secrets: {},
        substrate: {
          getSession: async () => ({ id: 'room@chatroom', title: 'Room', kind: 'group' }),
          listMessages,
        },
        allowList: { isAllowed: () => false },
        paths: { exportsDir },
        toast: vi.fn(),
      } as unknown as AppContext,
      {} as HostBridge,
      ipc.handle,
    )
    return { ipc, listMessages, exportsDir, cleanup: () => rmSync(exportsDir, { recursive: true, force: true }) }
  }

  it('writes only the senders picked in the chat filter', async () => {
    const { ipc, listMessages, cleanup } = exportSetup()
    try {
      const { path } = await ipc.invoke('substrate:export', {
        sessionId: 'room@chatroom',
        format: 'json',
        senderIds: ['wxid_kept'],
      })
      const written = JSON.parse(readFileSync(path, 'utf8')) as { messages: WxMessage[] }
      expect(written.messages.map((m) => m.senderId)).toEqual(['wxid_kept', 'wxid_kept'])
      expect(readFileSync(path, 'utf8')).not.toContain('wxid_hidden')
      expect(listMessages).toHaveBeenCalledWith(expect.objectContaining({ senderIds: ['wxid_kept'] }))
    } finally {
      cleanup()
    }
  })

  it('rejects a malformed sender filter without reading or writing anything', async () => {
    const { ipc, listMessages, exportsDir, cleanup } = exportSetup()
    try {
      await expect(
        Promise.resolve(
          ipc.invokeRaw('substrate:export', { sessionId: 'room@chatroom', format: 'json', senderIds: 'wxid_kept' }),
        ),
      ).rejects.toThrow()
      expect(listMessages).not.toHaveBeenCalled()
      expect(readdirSync(exportsDir)).toEqual([])
    } finally {
      cleanup()
    }
  })
})
