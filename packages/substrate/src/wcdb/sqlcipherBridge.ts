/**
 * Pure-TypeScript database engine: decrypts every SQLCipher database into the app cache
 * (decryptedCopy.ts) and queries that copy with node:sqlite. This is the engine used wherever
 * `resources/native` carries no WCDB build — today Windows, where WeChat's databases would otherwise
 * be unreadable even though the key scan succeeds.
 *
 * Copies survive the process on purpose (a restart then only re-decrypts what actually changed);
 * they live in the cache directory and are removed with it.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { isPlaintextSqlitePage, readFirstPage } from '../key/sqlcipherPage'
import { normalizeInt64, type SqlParam, type WcdbBridge, type WcdbLogger, type WcdbQueryResult } from './bridge'
import { DecryptedCopy } from './decryptedCopy'
import type { Row } from './rowDecoders'
import { resolvePageCipher } from './sqlcipherCodec'

export interface SqlcipherBridgeOptions {
  /** Where decrypted copies are kept (the app cache directory). */
  cacheDir: string
  logger?: WcdbLogger
}

interface OpenEntry {
  keyHex: string
  /** Absent when the source is already a plain SQLite file. */
  copy: DecryptedCopy | null
  db: DatabaseSync
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toInputValue(param: SqlParam): SQLInputValue {
  if (param === undefined) return null
  if (typeof param === 'boolean') return param ? 1 : 0
  return param
}

/** Match the WCDB bridge's row shape: Buffers for blobs, numbers/strings for int64. */
function normalizeRow(row: Record<string, unknown>): Row {
  const out: Row = {}
  for (const [name, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[name] = normalizeInt64(value)
    else if (value instanceof Uint8Array) out[name] = Buffer.from(value)
    else out[name] = value ?? null
  }
  return out
}

export class SqlcipherBridge implements WcdbBridge {
  private readonly entries = new Map<string, OpenEntry>()

  constructor(private readonly options: SqlcipherBridgeOptions) {}

  canOpen(dbPath: string, hexKey?: string): boolean {
    try {
      const entry = this.entry(dbPath, normalizeKey(hexKey))
      // node:sqlite opens lazily, so read the schema to prove the file really is a database.
      entry.db.prepare('SELECT count(*) FROM sqlite_master').get()
      return true
    } catch (error) {
      this.closeDatabase(dbPath)
      this.options.logger?.('debug', '[wcdb] sqlcipher engine could not open database', errorMessage(error))
      return false
    }
  }

  execQuery(dbPath: string, sql: string, params: SqlParam[] = [], hexKey?: string): WcdbQueryResult {
    if (!dbPath || !existsSync(dbPath)) return { success: false, error: `数据库不存在: ${dbPath}` }
    if (!sql.trim()) return { success: false, error: 'SQL 不能为空' }
    let entry: OpenEntry
    try {
      entry = this.entry(dbPath, normalizeKey(hexKey))
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
    try {
      const statement = entry.db.prepare(sql)
      // WeChat stores int64 ids that do not fit a JS number; without this node:sqlite throws on them.
      statement.setReadBigInts(true)
      const rows = statement.all(...params.map(toInputValue)).map(normalizeRow)
      return { success: true, rows }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  }

  closeDatabase(dbPath?: string): void {
    if (dbPath) {
      const entry = this.entries.get(dbPath)
      if (entry) {
        entry.db.close()
        this.entries.delete(dbPath)
      }
      return
    }
    for (const entry of this.entries.values()) entry.db.close()
    this.entries.clear()
  }

  dispose(): void {
    try {
      this.closeDatabase()
    } catch (error) {
      this.options.logger?.('debug', '[wcdb] sqlcipher engine dispose failed', errorMessage(error))
    }
  }

  // ----------------------------------------------------------------------------------------------

  private entry(dbPath: string, keyHex: string): OpenEntry {
    const cached = this.entries.get(dbPath)
    if (cached?.keyHex === keyHex) {
      // Reopen rather than let SQLite serve pages it cached before the refresh rewrote them.
      if (cached.copy?.refresh()) {
        cached.db.close()
        cached.db = openReadOnly(cached.copy.path)
      }
      return cached
    }
    if (cached) this.closeDatabase(dbPath)
    const created = this.create(dbPath, keyHex)
    this.entries.set(dbPath, created)
    return created
  }

  private create(dbPath: string, keyHex: string): OpenEntry {
    const page = readFirstPage(dbPath)
    if (!page) throw new Error(`无法读取数据库首页: ${dbPath}`)
    if (isPlaintextSqlitePage(page)) return { keyHex, copy: null, db: openReadOnly(dbPath) }
    if (!keyHex) throw new Error('数据库打开失败：路径、密钥或 SQLCipher 参数不匹配')
    if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('数据库密钥必须是 64 位十六进制字符串')
    const cipher = resolvePageCipher(page, keyHex)
    if (!cipher) throw new Error('密钥与数据库不匹配')
    const copy = new DecryptedCopy({
      dbPath,
      key: cipher.key,
      saltHex: cipher.saltHex,
      cacheDir: this.options.cacheDir,
      logger: this.options.logger,
    })
    copy.refresh(true)
    return { keyHex, copy, db: openReadOnly(copy.path) }
  }
}

function normalizeKey(hexKey?: string): string {
  return (hexKey ?? '').trim().toLowerCase()
}

function openReadOnly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true })
}
