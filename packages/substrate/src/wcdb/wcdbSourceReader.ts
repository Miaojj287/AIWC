/**
 * The real WeChat SourceReader: opens one account's WCDB databases through the koffi bridge and
 * exposes sessions / contacts / messages / media / change notifications per packages/substrate/src/source.ts.
 * Native code is only touched inside open(); constructing the reader is free.
 */
import type { WxAccount, WxContact, WxMedia, WxMessage, WxSession } from '@aiwc/protocol'
import type { SourceOpenOptions, SourceReader } from '../source'
import { verifyDbKey } from '../key/sqlcipherPage'
import { buildIdentityKeys, cleanAccountDirName } from './accountUtils'
import { ContactDirectory } from './contactQueries'
import {
  findMediaDbs,
  findMessageShards,
  findNamedDb,
  findSessionDbCandidates,
  resolveDbStoragePath,
  watchableDirs,
  type MessageShard,
} from './dbFiles'
import { extractMediaLocator } from './messageMapper'
import { findMessageRow, queryMessagesAfter, queryMessagesBefore, type MessageQueryContext } from './messageQueries'
import { resolveMediaFor, type MediaResolverContext } from './mediaResolver'
import { resolveWcdbLibrary } from './nativeLib'
import { OpenWcdbBridge } from './openWcdbBridge'
import { createBridgeQuery, yieldToLoop, type WcdbQuery } from './query'
import { assertReadOnlySql, wrapWithLimit } from './querySql'
import { querySessionActivity, querySessions, querySessionsChangedSince } from './sessionQueries'
import { MessageTableIndex } from './tableResolver'
import { watchDbDirs } from './watcher'
import { dirname } from 'node:path'

export interface WcdbSourceReaderOptions {
  /** resources/native root (contains <platform>-<arch>/libWCDBOpen.dylib etc.) */
  nativeDir: string
  /** Debounce for change notifications (ms). */
  watchDebounceMs?: number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

interface OpenState {
  opts: SourceOpenOptions
  dbStoragePath: string
  accountDir: string
  sessionDbPath: string
  contactDbPath: string | null
  hardlinkDbPath: string | null
  mediaDbPaths: string[]
  keyHex: string
  selfKeys: string[]
  q: WcdbQuery
  contacts: ContactDirectory
  index: MessageTableIndex
  shards: MessageShard[]
  shardsScannedAt: number
  lastSortTimestamp: number
}

type ChangeListener = (change: { sessionIds?: string[] }) => void

const SHARD_RESCAN_MS = 30_000

export class WcdbSourceReader implements SourceReader {
  readonly kind = 'wcdb' as const
  private readonly bridge = new OpenWcdbBridge()
  private state: OpenState | null = null
  private readonly listeners = new Set<ChangeListener>()
  private stopWatching: (() => void) | null = null

  constructor(private readonly options: WcdbSourceReaderOptions) {}

  isOpen(): boolean {
    return this.state !== null
  }

  async open(opts: SourceOpenOptions): Promise<void> {
    if (this.state) await this.close()
    const libraryPath = resolveWcdbLibrary(this.options.nativeDir)
    const init = this.bridge.initialize(libraryPath)
    if (!init.success) throw new Error(init.error || 'WCDB 初始化失败')

    const keyHex = opts.dbKeyHex.trim().toLowerCase()
    const dbStoragePath = resolveDbStoragePath(opts.dbRoot, opts.wxid)
    if (!dbStoragePath) throw new Error(`未找到账号目录或 db_storage: ${opts.dbRoot}`)
    const sessionCandidates = findSessionDbCandidates(dbStoragePath)
    if (sessionCandidates.length === 0) throw new Error(`未找到 session.db: ${dbStoragePath}`)

    let sessionDbPath: string | undefined
    let lastError = ''
    for (const candidate of sessionCandidates) {
      const check = verifyDbKey(candidate, keyHex)
      if (!check.ok) {
        lastError = check.error ?? ''
        continue
      }
      if (this.bridge.canOpen(candidate, keyHex)) {
        sessionDbPath = candidate
        break
      }
      lastError = 'WCDB 无法打开数据库'
    }
    if (!sessionDbPath) {
      this.bridge.dispose()
      throw new Error(lastError.includes('不匹配') ? '当前密钥与微信数据库不匹配，请重新获取当前登录账号的数据库密钥' : `数据库打开失败：${lastError || '未知原因'}`)
    }

    const q = createBridgeQuery(this.bridge, () => keyHex)
    const contactDbPath = findNamedDb(dbStoragePath, 'contact.db')
    const shards = findMessageShards(dbStoragePath)
    const state: OpenState = {
      opts,
      dbStoragePath,
      accountDir: dirname(dbStoragePath),
      sessionDbPath,
      contactDbPath,
      hardlinkDbPath: findNamedDb(dbStoragePath, 'hardlink.db'),
      mediaDbPaths: findMediaDbs(dbStoragePath),
      keyHex,
      selfKeys: Array.from(new Set([opts.wxid, cleanAccountDirName(opts.wxid)].filter(Boolean))),
      q,
      contacts: new ContactDirectory(q, contactDbPath, findNamedDb(dbStoragePath, 'head_image.db')),
      index: new MessageTableIndex(q, () => this.currentShards()),
      shards,
      shardsScannedAt: Date.now(),
      lastSortTimestamp: 0,
    }
    this.state = state
    this.log('info', 'wcdb source opened', { dbStoragePath, shards: shards.length, contact: !!contactDbPath })
    this.startWatching()
  }

  async close(): Promise<void> {
    this.stopWatching?.()
    this.stopWatching = null
    if (this.state) this.state.index.reset()
    this.state = null
    this.bridge.dispose()
  }

  async account(): Promise<WxAccount> {
    const s = this.requireOpen()
    let nickname: string | undefined
    let avatarPath: string | undefined
    for (const key of s.selfKeys) {
      const record = s.contacts.get(key)
      if (record) {
        nickname = record.nickname ?? record.displayName
        avatarPath = s.contacts.avatar(record.username)
        break
      }
    }
    return { wxid: s.opts.wxid, nickname, avatarPath, dbRoot: s.opts.dbRoot, verified: true }
  }

  async sessions(onPage?: (sessions: readonly WxSession[]) => void): Promise<WxSession[]> {
    const s = this.requireOpen()
    const contacts = s.contacts.available ? s.contacts : null
    const list = await querySessions({ q: s.q, sessionDbPath: s.sessionDbPath, contacts }, yieldToLoop, onPage)
    for (const session of list) {
      if (session.lastMessageAt) s.lastSortTimestamp = Math.max(s.lastSortTimestamp, Math.floor(session.lastMessageAt / 1000))
    }
    return list
  }

  async contacts(): Promise<WxContact[]> {
    const s = this.requireOpen()
    if (!s.contacts.available) return []
    let activity = new Map<string, number>()
    try {
      activity = querySessionActivity(s.q, s.sessionDbPath)
    } catch (error) {
      this.log('warn', 'session activity unavailable', error)
    }
    return s.contacts.contactsAsync(activity, yieldToLoop)
  }

  async groupMembers(groupId: string): Promise<WxContact[]> {
    const s = this.requireOpen()
    return s.contacts.groupMembers(groupId)
  }

  async messagesAfter(sessionId: string, afterSeq: number, limit: number): Promise<WxMessage[]> {
    return queryMessagesAfter(this.messageContext(), sessionId, afterSeq, limit)
  }

  async messagesBefore(sessionId: string, beforeSeq: number, limit: number): Promise<WxMessage[]> {
    return queryMessagesBefore(this.messageContext(), sessionId, beforeSeq, limit)
  }

  async resolveMedia(message: WxMessage): Promise<WxMedia | undefined> {
    const s = this.requireOpen()
    if (!message.media) return undefined
    const located = findMessageRow(this.messageContext(), message.sessionId, message.id, message.seq)
    if (!located) return message.media.path ? message.media : undefined
    const locator = extractMediaLocator(located.row, located.raw)
    if (!locator) return undefined
    const ctx: MediaResolverContext = {
      q: s.q,
      accountDir: s.accountDir,
      cacheDir: s.opts.cacheDir,
      nativeDir: this.options.nativeDir,
      hardlinkDbPath: s.hardlinkDbPath,
      mediaDbPaths: s.mediaDbPaths,
      imageKeys: s.opts.imageKeys,
      selfKeys: s.selfKeys,
    }
    const resolved = await resolveMediaFor(ctx, { sessionId: message.sessionId, messageId: message.id, raw: located.raw, row: located.row, locator })
    if (!resolved) return undefined
    return {
      ...message.media,
      ...resolved,
      durationMs: resolved.durationMs ?? message.media.durationMs,
      fileName: resolved.fileName ?? message.media.fileName,
      sizeBytes: resolved.sizeBytes ?? message.media.sizeBytes,
    }
  }

  watch(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async querySql(db: 'message' | 'contact' | 'session', sql: string, limit: number): Promise<{ columns: string[]; rows: unknown[][] }> {
    const s = this.requireOpen()
    const wrapped = wrapWithLimit(assertReadOnlySql(sql), limit)
    const targets: string[] =
      db === 'session' ? [s.sessionDbPath] : db === 'contact' ? (s.contactDbPath ? [s.contactDbPath] : []) : this.currentShards().map((x) => x.dbPath)
    if (targets.length === 0) throw new Error(`${db} 数据库不可用`)
    const safeLimit = Math.max(1, Math.min(10_000, Math.floor(limit) || 200))
    let columns: string[] = []
    const rows: unknown[][] = []
    let lastError: unknown
    for (const dbPath of targets) {
      try {
        const result = s.q.all(dbPath, wrapped)
        for (const row of result) {
          if (columns.length === 0) columns = Object.keys(row)
          rows.push(columns.map((c) => normalizeSqlValue(row[c])))
          if (rows.length >= safeLimit) return { columns, rows }
        }
      } catch (error) {
        lastError = error
      }
      if (targets.length > 1) await yieldToLoop()
    }
    if (rows.length === 0 && columns.length === 0 && lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError))
    return { columns, rows }
  }

  // ----------------------------------------------------------------------------------------------

  private requireOpen(): OpenState {
    if (!this.state) throw new Error('数据源尚未打开')
    return this.state
  }

  private currentShards(): MessageShard[] {
    const s = this.requireOpen()
    if (Date.now() - s.shardsScannedAt > SHARD_RESCAN_MS) {
      s.shards = findMessageShards(s.dbStoragePath)
      s.shardsScannedAt = Date.now()
    }
    return s.shards
  }

  private messageContext(): MessageQueryContext {
    const s = this.requireOpen()
    return {
      q: s.q,
      index: s.index,
      selfWxid: s.opts.wxid,
      selfKeys: s.selfKeys,
      resolveName: (sessionId, username) => {
        if (buildIdentityKeys(username).some((k) => s.selfKeys.map((x) => x.toLowerCase()).includes(k))) {
          return s.contacts.get(username)?.displayName ?? s.contacts.get(cleanAccountDirName(username))?.displayName
        }
        return s.contacts.senderNameIn(sessionId, username)
      },
      onShardError: (dbPath, error) => {
        this.log('warn', 'shard query failed', { dbPath, error: error instanceof Error ? error.message : String(error) })
        const text = error instanceof Error ? error.message : String(error)
        if (/malformed|corrupt|not a database/i.test(text)) {
          this.bridge.closeDatabase(dbPath)
          s.index.invalidate()
        }
      },
    }
  }

  private startWatching(): void {
    const s = this.requireOpen()
    const dirs = watchableDirs(s.dbStoragePath)
    if (dirs.length === 0) return
    this.stopWatching = watchDbDirs(dirs, {
      debounceMs: this.options.watchDebounceMs ?? 250,
      onChange: (files) => this.handleChange(files),
      onError: (error) => this.log('warn', 'fs.watch error', error.message),
    })
  }

  private handleChange(files: string[]): void {
    const s = this.state
    if (!s || this.listeners.size === 0) return
    s.index.invalidate()
    if (files.some((f) => /^(message|biz_message)_\d+\.db/i.test(f))) {
      s.shards = findMessageShards(s.dbStoragePath)
      s.shardsScannedAt = Date.now()
    }
    if (files.some((f) => /^(contact|head_image)\.db/i.test(f))) s.contacts.invalidate()
    let sessionIds: string[] | undefined
    try {
      const changed = querySessionsChangedSince(s.q, s.sessionDbPath, s.lastSortTimestamp)
      s.lastSortTimestamp = changed.maxSortTimestamp
      sessionIds = changed.ids.length > 0 ? changed.ids : undefined
    } catch (error) {
      this.log('debug', 'change diff failed', error)
    }
    for (const listener of this.listeners) {
      try {
        listener(sessionIds ? { sessionIds } : {})
      } catch (error) {
        this.log('warn', 'watch listener threw', error)
      }
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown): void {
    this.options.logger?.(level, `[wcdb] ${msg}`, meta)
  }
}

function normalizeSqlValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (typeof value === 'bigint') return value.toString()
  return value
}

export function createWcdbSourceReader(opts: WcdbSourceReaderOptions): SourceReader {
  return new WcdbSourceReader(opts)
}
