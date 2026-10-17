import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConfig,
  type InvokeChannel,
  type InvokeReq,
  type InvokeRes,
  type ListMessagesQuery,
  type WxMessage,
} from '@aiwc/protocol'
import { runKeyHost } from '../substrate/keyAcquireClient'
import type { AppContext } from '../contracts'
import type { HostBridge } from './register'
import { registerSubstrateIpc } from './substrate'
import { createHandlerHarness } from './testing/handlerHarness'
import { setMainLanguage, t } from '../i18n'
import { createConfigService } from '../config/configService'
import { createSecretStore, SECRET_REFS } from '../config/secretStore'

vi.mock('../substrate/keyAcquireClient', () => ({ runKeyHost: vi.fn() }))
vi.mock('@aiwc/substrate', () => ({
  acquireKeys: vi.fn(),
  findWeChatPidSync: vi.fn(() => null),
  scanMacDbKey: vi.fn(),
  scanMacDbKeyFromDumps: vi.fn(),
  detectWeChat: vi.fn(),
  listAccounts: vi.fn(),
  verifyAccount: vi.fn().mockResolvedValue({ ok: true }),
}))

beforeEach(() => {
  vi.mocked(runKeyHost).mockReset().mockResolvedValue({ database: true, matched: 1, total: 1, missing: [] })
})

function setup(accountSession?: HostBridge['accountSession'], ready = false) {
  const config = { ...defaultConfig(), account: { wxid: 'new', dbRoot: '/new', dbKeyRef: 'account:dbKey' } }
  const secrets = { set: vi.fn(), reveal: vi.fn((): string | undefined => 'a'.repeat(64)), delete: vi.fn() }
  const set = vi.fn()
  const reconnect = vi.fn(async () => ({ ok: true }))
  const close = vi.fn(async () => {})
  const logger = { child: () => logger }
  const ipc = createHandlerHarness()
  registerSubstrateIpc(
    {
      logger,
      config: { get: () => config, set },
      secrets,
      substrate: { status: () => ({ connection: ready ? 'ready' : 'no_config' }), reconnect, close },
      paths: {},
    } as unknown as AppContext,
    { accountSession } as HostBridge,
    ipc.handle,
  )
  const invoke = <K extends InvokeChannel>(channel: K, req: InvokeReq<K>) => ipc.invoke(channel, req) as InvokeRes<K>
  return { secrets, set, reconnect, close, invoke, invokeRaw: ipc.invokeRaw }
}

describe('clearing a saved WeChat key', () => {
  it('clears an open database connection once without reopening it with deleted credentials', async () => {
    const { invoke, secrets, close, reconnect } = setup(undefined, true)
    reconnect.mockResolvedValue({ ok: false })
    await expect(invoke('substrate:clearKey', { kind: 'db_key' })).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
    expect(reconnect).not.toHaveBeenCalled()
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(secrets.delete.mock.invocationCallOrder[0] ?? 0)
    expect(secrets.delete).toHaveBeenCalledWith(SECRET_REFS.dbCredentials)
  })
  it('keeps saved credentials if closing the current database fails', async () => {
    const { invoke, secrets, close, set } = setup(undefined, true)
    close.mockRejectedValueOnce(new Error('close failed'))
    await expect(invoke('substrate:clearKey', { kind: 'db_key' })).rejects.toThrow('close failed')
    expect(secrets.delete).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
  it('updates image credentials on the open reader without closing the database connection', async () => {
    const { invoke, close, reconnect } = setup(undefined, true)
    await invoke('substrate:clearKey', { kind: 'image_aes' })
    expect(reconnect).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })
  it('does not close the current reader when clearing a different account', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aiwc-clear-other-'))
    try {
      const config = createConfigService({ file: join(root, 'config.json') })
      const options = {
        file: join(root, 'secrets.bin'),
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (value: string) => Buffer.from(value),
          decryptString: (value: Buffer) => value.toString(),
        },
      }
      const secrets = createSecretStore(options)
      secrets.set(SECRET_REFS.dbCredentials, 'synthetic database bundle')
      secrets.set(SECRET_REFS.dbKey, 'a'.repeat(64))
      secrets.set(SECRET_REFS.imageAesKey, 'b'.repeat(32))
      config.set({
        account: {
          wxid: 'other',
          dbRoot: '/other',
          dbCredentialsRef: SECRET_REFS.dbCredentials,
          dbKeyRef: SECRET_REFS.dbKey,
          imageAesKeyRef: SECRET_REFS.imageAesKey,
        },
      })
      const credentials = vi.fn(() => ({ config, secrets }))
      const { invoke, close, reconnect } = setup({ credentials, switch: vi.fn(), isSwitching: () => false }, true)
      await invoke('substrate:clearKey', { kind: 'db_key', target: { wxid: 'other', dbRoot: '/other' } })
      const reloaded = createSecretStore(options)
      expect(reloaded.has(SECRET_REFS.dbCredentials)).toBe(false)
      expect(reloaded.has(SECRET_REFS.dbKey)).toBe(false)
      expect(reloaded.has(SECRET_REFS.imageAesKey)).toBe(true)
      const account = createConfigService({ file: join(root, 'config.json') }).get().account
      expect(account.dbCredentialsRef).toBeUndefined()
      expect(account.dbKeyRef).toBeUndefined()
      expect(account).toMatchObject({ credentialRevision: 1, verifiedAt: 0 })
      expect(close).not.toHaveBeenCalled()
      expect(reconnect).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('deletes conventional and configured refs, invalidates the reader, and drops database verification', async () => {
    const { invoke, secrets, set } = setup()
    await invoke('substrate:clearKey', { kind: 'db_key' })
    expect(secrets.delete).toHaveBeenCalledWith('account.dbKey')
    expect(secrets.delete).toHaveBeenCalledWith('account:dbKey')
    expect(set).toHaveBeenCalledWith({
      account: { verifiedAt: 0, dbCredentialsRef: null, dbKeyRef: null, credentialRevision: 1 },
    })
  })
  it('invalidates media credentials while keeping database verification when an image key is cleared', async () => {
    const { invoke, secrets, set } = setup()
    await invoke('substrate:clearKey', { kind: 'image_aes' })
    expect(secrets.delete).toHaveBeenCalledWith('account.imageAesKey')
    expect(set).toHaveBeenCalledWith({ account: { imageAesKeyRef: null, credentialRevision: 1 } })
  })
  it('refuses anything that is not one of the three WeChat keys', async () => {
    const { invokeRaw, secrets } = setup()
    await expect(invokeRaw('substrate:clearKey', { kind: 'toString' })).rejects.toThrow()
    await expect(
      invokeRaw('substrate:clearKey', { kind: 'db_key', target: { wxid: '..', dbRoot: '/x' } }),
    ).rejects.toThrow()
    expect(secrets.delete).not.toHaveBeenCalled()
  })
})

describe('manual WeChat key IPC', () => {
  it.each([
    ['db_key', ` 0x${'AB '.repeat(32)} `, 'ab'.repeat(32)],
    ['image_xor', '0x53', '53'],
    ['image_aes', 'AbCdEfGh12345678', '41624364456647683132333435363738'],
    ['image_aes', `0x${'AB'.repeat(16)}`, 'ab'.repeat(16)],
  ] as const)('accepts and normalizes %s with its own format', async (kind, hex, expected) => {
    const { invoke, secrets } = setup()
    expect(await invoke('substrate:setManualKey', { kind, hex })).toEqual({ ok: true })
    expect(secrets.set).toHaveBeenCalledWith(expect.any(String), expected)
  })
  it('applies manually saved image credentials to the active reader immediately', async () => {
    const { invoke, set, reconnect } = setup(undefined, true)
    expect(await invoke('substrate:setManualKey', { kind: 'image_xor', hex: '53' })).toEqual({ ok: true })
    expect(set).toHaveBeenCalledWith({ account: { imageXorKeyRef: SECRET_REFS.imageXorKey, credentialRevision: 1 } })
    expect(reconnect).toHaveBeenCalledOnce()
  })
  it('rejects malformed manual-key IPC before writing to any store', async () => {
    const { invokeRaw, secrets } = setup()
    await expect(invokeRaw('substrate:setManualKey', { kind: 'toString', hex: '53' })).rejects.toThrow()
    await expect(
      invokeRaw('substrate:setManualKey', { kind: 'image_xor', hex: '53', target: { wxid: '..', dbRoot: '/x' } }),
    ).rejects.toThrow()
    expect(secrets.set).not.toHaveBeenCalled()
  })
  it('never saves malformed keys', async () => {
    const { invoke, secrets } = setup()
    expect((await invoke('substrate:setManualKey', { kind: 'image_xor', hex: 'a'.repeat(64) })).ok).toBe(false)
    expect(secrets.set).not.toHaveBeenCalled()
  })
  it('tests the explicitly selected account instead of the previously saved account', async () => {
    const { invoke } = setup()
    await invoke('substrate:testConnection', { wxid: 'new', dbRoot: '/new' })
    expect(runKeyHost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ wxid: 'new', dbRoot: '/new' }),
        dbKeyHex: 'a'.repeat(64),
        operation: 'inspect',
      }),
    )
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
      vi.mocked(runKeyHost).mockClear()
      vi.mocked(runKeyHost).mockResolvedValueOnce({
        database: hasSavedKey,
        matched: hasSavedKey ? 1 : 0,
        total: 1,
        missing: hasSavedKey ? [] : ['session/session.db'],
      })
      const result = await current.invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
      expect(credentials).toHaveBeenCalledWith({ wxid: 'new', dbRoot: '/new' })
      expect(current.secrets.reveal).not.toHaveBeenCalled()
      expect(result.ok).toBe(hasSavedKey)
      expect(runKeyHost).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ wxid: 'new', dbRoot: '/new' }),
          dbKeyHex: hasSavedKey ? 'b'.repeat(64) : undefined,
          operation: 'inspect',
        }),
      )
      expect(secrets.has(SECRET_REFS.dbKey)).toBe(hasSavedKey)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects verification without a saved database key instead of accepting directory-only validation', async () => {
    const { invoke, secrets } = setup()
    secrets.reveal.mockReturnValueOnce(undefined)
    vi.mocked(runKeyHost).mockClear()
    vi.mocked(runKeyHost).mockResolvedValueOnce({
      database: false,
      matched: 0,
      total: 1,
      missing: ['session/session.db'],
    })
    const result = await invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
    expect(result).toEqual({ ok: false, error: t('main.substrate.accountKeyMissing') })
    expect(runKeyHost).toHaveBeenCalledWith(expect.objectContaining({ operation: 'inspect', dbKeyHex: undefined }))
  })

  it('guides the user to reacquire the key when database verification fails', async () => {
    const { invoke } = setup()
    vi.mocked(runKeyHost).mockResolvedValueOnce({
      database: false,
      matched: 0,
      total: 1,
      missing: ['session/session.db'],
    })
    const result = await invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('连接')
  })

  it('localizes both the mismatch and recovery guidance in English', async () => {
    setMainLanguage('en-US')
    try {
      const { invoke } = setup()
      vi.mocked(runKeyHost).mockResolvedValueOnce({
        database: false,
        matched: 0,
        total: 1,
        missing: ['session/session.db'],
      })
      const result = await invoke('substrate:verifyAccount', { wxid: 'new', dbRoot: '/new' })
      expect(result.error).toContain('connect')
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
        substrate: { status: () => ({ connection: 'no_config' }) },
        paths: { nativeDir: '/native' },
        broadcast: vi.fn(),
        toast,
      } as unknown as AppContext,
      {} as HostBridge,
      ipc.handle,
    )
    return { ipc, secrets, toast }
  }
  // A run that only ends when its signal aborts, like a bounded native scan.
  const waitForAbort = async (opts: { signal?: AbortSignal }) => {
    await new Promise<void>((resolve) => opts.signal?.addEventListener('abort', () => resolve(), { once: true }))
    return { steps: [], cancelled: true, dbKeyHex: 'a'.repeat(64) }
  }

  it('cancel aborts the running acquisition, which then stores nothing and toasts nothing', async () => {
    vi.mocked(runKeyHost).mockImplementation(waitForAbort)
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
    vi.mocked(runKeyHost).mockImplementation(async (opts) => {
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
