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
import { verifyAccount } from '@aiwc/substrate'
import type { AppContext } from '../contracts'
import type { HostBridge } from './register'
import { registerSubstrateIpc } from './substrate'
import { createHandlerHarness } from './testing/handlerHarness'

vi.mock('@aiwc/substrate', () => ({
  acquireKeys: vi.fn(),
  detectWeChat: vi.fn(),
  listAccounts: vi.fn(),
  verifyAccount: vi.fn().mockResolvedValue({ ok: true }),
}))

function setup() {
  const config = { ...defaultConfig(), account: { wxid: 'old', dbRoot: '/old', dbKeyRef: 'account:dbKey' } }
  const secrets = { set: vi.fn(), reveal: vi.fn(() => 'a'.repeat(64)) }
  const set = vi.fn()
  const logger = { child: () => logger }
  const ipc = createHandlerHarness()
  registerSubstrateIpc(
    { logger, config: { get: () => config, set }, secrets, substrate: {} } as unknown as AppContext,
    {} as HostBridge,
    ipc.handle,
  )
  // setManualKey answers synchronously; the tests read its result without awaiting.
  const invoke = <K extends InvokeChannel>(channel: K, req: InvokeReq<K>) => ipc.invoke(channel, req) as InvokeRes<K>
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
