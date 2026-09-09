/**
 * koffi adapter for the C bridge exported by the source-built Tencent WCDB (SQLCipher inside).
 * No Electron dependency; runs in the substrate utility process. koffi is loaded lazily in
 * `initialize()` so importing this module is side-effect free and tests never touch native code.
 *
 * Database objects are cached per file so the (expensive) PBKDF2 key setup happens once per db.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { classifyKeyAgainstPage, readFirstPage, type DbKeyForm } from '../key/sqlcipherPage'
import type { Row } from './rowDecoders'

const requireNative = createRequire(import.meta.url)

type NativeRef = { innerValue: unknown }
// koffi is untyped at the call site; we keep the surface small and wrap everything below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KoffiFn = (...args: any[]) => any

export type SqlParam = string | number | bigint | boolean | null | undefined | Buffer | Uint8Array

export interface WcdbQueryResult {
  success: boolean
  rows?: Row[]
  error?: string
}

const WCDB_COLUMN_INTEGER = 1
const WCDB_COLUMN_FLOAT = 2
const WCDB_COLUMN_STRING = 3
const WCDB_COLUMN_BLOB = 4
const WCDB_CIPHER_VERSION_4 = 4
const WECHAT_CIPHER_PAGE_SIZE = 4096

function hasRef(value: NativeRef | null | undefined): value is NativeRef {
  return !!value?.innerValue
}

function normalizeInt64(value: number | bigint): number | string {
  if (typeof value === 'number') return value
  if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(value)
  return value.toString()
}

interface OpenDatabase {
  ref: NativeRef
  keyHex: string
}

export class OpenWcdbBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private koffi: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private lib: any = null
  private fn: Record<string, KoffiFn> = {}
  private readonly databases = new Map<string, OpenDatabase>()
  private readonly keyForms = new Map<string, DbKeyForm | null>()

  get initialized(): boolean {
    return !!this.lib
  }

  initialize(libraryPath: string): { success: boolean; error?: string } {
    if (this.lib) return { success: true }
    if (!libraryPath || !existsSync(libraryPath)) return { success: false, error: `WCDB 动态库不存在: ${libraryPath}` }
    try {
      this.koffi = requireNative('koffi')
      this.lib = this.koffi.load(libraryPath)
      const Ref = this.koffi.struct({ innerValue: 'void *' })
      const f = (name: string, result: string | unknown, args: unknown[]): KoffiFn => this.lib.func(name, result, args)
      this.fn = {
        createDatabase: f('WCDBCoreCreateDatabase', Ref, ['str', 'bool', 'bool']),
        configCipher: f('WCDBDatabaseConfigCipher', 'void', [Ref, 'uint8_t *', 'int', 'int', 'int']),
        canOpen: f('WCDBDatabaseCanOpen', 'bool', [Ref]),
        getHandle: f('WCDBDatabaseGetHandle', Ref, [Ref, 'bool']),
        closeDatabase: f('WCDBDatabaseClose', 'void', [Ref, 'void *', 'void *']),
        purge: f('WCDBDatabasePurge', 'void', [Ref]),
        prepare: f('WCDBHandleGetOrCreatePreparedSQL', Ref, [Ref, 'str']),
        finalizeStatements: f('WCDBHandleFinalizeStatements', 'void', [Ref]),
        step: f('WCDBHandleStatementStep', 'bool', [Ref]),
        isDone: f('WCDBHandleStatementIsDone', 'bool', [Ref]),
        columnCount: f('WCDBHandleStatementGetColumnCount', 'int', [Ref]),
        columnName: f('WCDBHandleStatementGetColumnName', 'str', [Ref, 'int']),
        columnType: f('WCDBHandleStatementGetColumnType', 'int', [Ref, 'int']),
        getInteger: f('WCDBHandleStatementGetInteger', 'int64', [Ref, 'int']),
        getDouble: f('WCDBHandleStatementGetDouble', 'double', [Ref, 'int']),
        getText: f('WCDBHandleStatementGetText', 'str', [Ref, 'int']),
        getBlob: f('WCDBHandleStatementGetBlob', 'void *', [Ref, 'int']),
        columnSize: f('WCDBHandleStatementGetColumnSize', 'int64', [Ref, 'int']),
        bindInteger: f('WCDBHandleStatementBindInteger', 'void', [Ref, 'int', 'int64']),
        bindDouble: f('WCDBHandleStatementBindDouble', 'void', [Ref, 'int', 'double']),
        bindText: f('WCDBHandleStatementBindText', 'void', [Ref, 'int', 'str']),
        bindBlob: f('WCDBHandleStatementBindBlob', 'void', [Ref, 'int', 'uint8_t *', 'uint64']),
        bindNull: f('WCDBHandleStatementBindNull', 'void', [Ref, 'int']),
        release: f('WCDBReleaseCPPObject', 'void', ['void *']),
      }
      return { success: true }
    } catch (error) {
      this.dispose()
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** True when the database opens with this key (also warms the database cache). */
  canOpen(dbPath: string, hexKey?: string): boolean {
    try {
      return !!this.openDatabase(dbPath, hexKey)
    } catch {
      return false
    }
  }

  execQuery(dbPath: string, sql: string, params: SqlParam[] = [], hexKey?: string): WcdbQueryResult {
    if (!this.lib) return { success: false, error: 'WCDB 尚未初始化' }
    if (!dbPath || !existsSync(dbPath)) return { success: false, error: `数据库不存在: ${dbPath}` }
    if (!sql.trim()) return { success: false, error: 'SQL 不能为空' }

    let database: NativeRef | null
    try {
      database = this.openDatabase(dbPath, hexKey)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (!database) return { success: false, error: '数据库打开失败：路径、密钥或 SQLCipher 参数不匹配' }

    let handle: NativeRef | null = null
    let statement: NativeRef | null = null
    try {
      handle = this.fn.getHandle!(database, false) as NativeRef
      if (!hasRef(handle)) return { success: false, error: '获取 WCDB 只读句柄失败' }
      statement = this.fn.prepare!(handle, sql) as NativeRef
      if (!hasRef(statement)) return { success: false, error: `SQL prepare 失败: ${sql.slice(0, 120)}` }
      params.forEach((value, index) => this.bindValue(statement as NativeRef, index + 1, value))
      const rows: Row[] = []
      while (this.fn.step!(statement)) {
        if (this.fn.isDone!(statement)) break
        rows.push(this.readRow(statement))
      }
      if (!this.fn.isDone!(statement)) return { success: false, error: `SQL step 失败: ${sql.slice(0, 120)}` }
      return { success: true, rows }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (hasRef(statement)) this.fn.release!(statement.innerValue)
      if (hasRef(handle)) {
        this.fn.finalizeStatements!(handle)
        this.fn.release!(handle.innerValue)
      }
    }
  }

  /** Close one cached database (e.g. after a corruption error) or all of them. */
  closeDatabase(dbPath?: string): void {
    if (dbPath) {
      const open = this.databases.get(dbPath)
      if (open) {
        this.destroyDatabase(open.ref)
        this.databases.delete(dbPath)
      }
      return
    }
    for (const open of this.databases.values()) this.destroyDatabase(open.ref)
    this.databases.clear()
  }

  dispose(): void {
    try {
      this.closeDatabase()
    } catch {
      // best effort
    }
    this.keyForms.clear()
    this.fn = {}
    this.lib = null
    this.koffi = null
  }

  private openDatabase(dbPath: string, hexKey?: string): NativeRef | null {
    const keyHex = (hexKey || '').trim().toLowerCase()
    const cached = this.databases.get(dbPath)
    if (cached && cached.keyHex === keyHex) return cached.ref
    if (cached) this.closeDatabase(dbPath)

    const database = this.fn.createDatabase!(dbPath, true, false) as NativeRef
    if (!hasRef(database)) return null
    if (keyHex) {
      if (!/^[0-9a-f]{64}$/.test(keyHex)) {
        this.destroyDatabase(database)
        throw new Error('数据库密钥必须是 64 位十六进制字符串')
      }
      const keyBytes = this.cipherKeyBytes(dbPath, keyHex)
      this.fn.configCipher!(database, keyBytes, keyBytes.length, WECHAT_CIPHER_PAGE_SIZE, WCDB_CIPHER_VERSION_4)
    }
    if (!this.fn.canOpen!(database)) {
      this.destroyDatabase(database)
      return null
    }
    this.databases.set(dbPath, { ref: database, keyHex })
    return database
  }

  /**
   * SQLCipher accepts either a passphrase (PBKDF2 applied) or a raw key spelled `x'<hex>'`.
   * WeChat's in-memory key is the passphrase form; Windows Config.Cipher yields the derived form.
   * We check page 1 in pure TS once per database and pick the matching representation.
   */
  private cipherKeyBytes(dbPath: string, keyHex: string): Buffer {
    const cacheKey = `${dbPath}\0${keyHex}`
    let form = this.keyForms.get(cacheKey)
    if (form === undefined) {
      const page = readFirstPage(dbPath)
      form = page ? classifyKeyAgainstPage(page, keyHex) : null
      this.keyForms.set(cacheKey, form)
    }
    if (form === 'direct') return Buffer.from(`x'${keyHex}'`, 'ascii')
    return Buffer.from(keyHex, 'hex')
  }

  private destroyDatabase(database: NativeRef): void {
    if (!hasRef(database)) return
    try { this.fn.closeDatabase!(database, null, null) } catch { /* best effort */ }
    try { this.fn.purge!(database) } catch { /* best effort */ }
    try { this.fn.release!(database.innerValue) } catch { /* best effort */ }
  }

  private bindValue(statement: NativeRef, index: number, value: SqlParam): void {
    if (value === null || value === undefined) {
      this.fn.bindNull!(statement, index)
    } else if (typeof value === 'bigint') {
      this.fn.bindInteger!(statement, index, value)
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`参数 ${index} 不是有限数值`)
      if (Number.isInteger(value)) this.fn.bindInteger!(statement, index, value)
      else this.fn.bindDouble!(statement, index, value)
    } else if (typeof value === 'boolean') {
      this.fn.bindInteger!(statement, index, value ? 1 : 0)
    } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const bytes = Buffer.from(value)
      this.fn.bindBlob!(statement, index, bytes, bytes.length)
    } else {
      this.fn.bindText!(statement, index, String(value))
    }
  }

  private readRow(statement: NativeRef): Row {
    const row: Row = {}
    const count = Number(this.fn.columnCount!(statement))
    for (let index = 0; index < count; index += 1) {
      const name = String(this.fn.columnName!(statement, index) || `column_${index}`)
      const type = Number(this.fn.columnType!(statement, index))
      switch (type) {
        case WCDB_COLUMN_INTEGER:
          row[name] = normalizeInt64(this.fn.getInteger!(statement, index) as number | bigint)
          break
        case WCDB_COLUMN_FLOAT:
          row[name] = Number(this.fn.getDouble!(statement, index))
          break
        case WCDB_COLUMN_STRING:
          row[name] = String(this.fn.getText!(statement, index) ?? '')
          break
        case WCDB_COLUMN_BLOB: {
          const size = Number(this.fn.columnSize!(statement, index))
          const pointer = this.fn.getBlob!(statement, index)
          if (!pointer || !Number.isSafeInteger(size) || size <= 0) {
            row[name] = Buffer.alloc(0)
            break
          }
          const copied = this.koffi.decode(pointer, 'uint8_t', size) as ArrayLike<number>
          row[name] = Buffer.from(copied)
          break
        }
        default:
          row[name] = null
      }
    }
    return row
  }
}
