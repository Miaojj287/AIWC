import { existsSync } from 'fs'
import { createRequire } from 'module'

const requireNative = createRequire(import.meta.url)

type NativeRef = { innerValue: unknown }

export type OpenWcdbQueryResult = {
  success: boolean
  rows?: Array<Record<string, unknown>>
  error?: string
}

export type OpenWcdbParam = string | number | bigint | boolean | null | Buffer | Uint8Array

const WCDB_COLUMN_INTEGER = 1
const WCDB_COLUMN_FLOAT = 2
const WCDB_COLUMN_STRING = 3
const WCDB_COLUMN_BLOB = 4
const WCDB_COLUMN_NULL = 5

const WCDB_CIPHER_VERSION_4 = 4
const WECHAT_CIPHER_PAGE_SIZE = 4096

function hasNativeRef(value: NativeRef | null | undefined): value is NativeRef {
  return !!value?.innerValue
}

function normalizeInt64(value: number | bigint): number | string {
  if (typeof value === 'number') return value
  if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value)
  }
  return value.toString()
}

/**
 * Direct adapter for the C bridge exported by a source-built Tencent WCDB.
 *
 * This class deliberately has no Electron dependency. It can run in the WCDB
 * utility process and does not perform licensing, device identification or
 * network requests.
 */
export class OpenWcdbBridge {
  private koffi: any = null
  private lib: any = null
  private Ref: any = null

  private coreCreateDatabase: any = null
  private databaseConfigCipher: any = null
  private databaseCanOpen: any = null
  private databaseGetHandle: any = null
  private databaseClose: any = null
  private databasePurge: any = null
  private handleGetOrCreatePreparedSql: any = null
  private handleFinalizeStatements: any = null
  private statementStep: any = null
  private statementIsDone: any = null
  private statementGetColumnCount: any = null
  private statementGetColumnName: any = null
  private statementGetColumnType: any = null
  private statementGetInteger: any = null
  private statementGetDouble: any = null
  private statementGetText: any = null
  private statementGetBlob: any = null
  private statementGetColumnSize: any = null
  private statementBindInteger: any = null
  private statementBindDouble: any = null
  private statementBindText: any = null
  private statementBindBlob: any = null
  private statementBindNull: any = null
  private releaseCppObject: any = null

  initialize(libraryPath: string): { success: boolean; error?: string } {
    if (this.lib) return { success: true }
    if (!libraryPath || !existsSync(libraryPath)) {
      return { success: false, error: `开源 WCDB 动态库不存在: ${libraryPath}` }
    }

    try {
      this.koffi = requireNative('koffi')
      this.lib = this.koffi.load(libraryPath)
      this.Ref = this.koffi.struct({ innerValue: 'void *' })

      this.coreCreateDatabase = this.lib.func('WCDBCoreCreateDatabase', this.Ref, ['str', 'bool', 'bool'])
      this.databaseConfigCipher = this.lib.func('WCDBDatabaseConfigCipher', 'void', [
        this.Ref, 'uint8_t *', 'int', 'int', 'int'
      ])
      this.databaseCanOpen = this.lib.func('WCDBDatabaseCanOpen', 'bool', [this.Ref])
      this.databaseGetHandle = this.lib.func('WCDBDatabaseGetHandle', this.Ref, [this.Ref, 'bool'])
      this.databaseClose = this.lib.func('WCDBDatabaseClose', 'void', [this.Ref, 'void *', 'void *'])
      this.databasePurge = this.lib.func('WCDBDatabasePurge', 'void', [this.Ref])
      this.handleGetOrCreatePreparedSql = this.lib.func('WCDBHandleGetOrCreatePreparedSQL', this.Ref, [this.Ref, 'str'])
      this.handleFinalizeStatements = this.lib.func('WCDBHandleFinalizeStatements', 'void', [this.Ref])
      this.statementStep = this.lib.func('WCDBHandleStatementStep', 'bool', [this.Ref])
      this.statementIsDone = this.lib.func('WCDBHandleStatementIsDone', 'bool', [this.Ref])
      this.statementGetColumnCount = this.lib.func('WCDBHandleStatementGetColumnCount', 'int', [this.Ref])
      this.statementGetColumnName = this.lib.func('WCDBHandleStatementGetColumnName', 'str', [this.Ref, 'int'])
      this.statementGetColumnType = this.lib.func('WCDBHandleStatementGetColumnType', 'int', [this.Ref, 'int'])
      this.statementGetInteger = this.lib.func('WCDBHandleStatementGetInteger', 'int64', [this.Ref, 'int'])
      this.statementGetDouble = this.lib.func('WCDBHandleStatementGetDouble', 'double', [this.Ref, 'int'])
      this.statementGetText = this.lib.func('WCDBHandleStatementGetText', 'str', [this.Ref, 'int'])
      this.statementGetBlob = this.lib.func('WCDBHandleStatementGetBlob', 'void *', [this.Ref, 'int'])
      this.statementGetColumnSize = this.lib.func('WCDBHandleStatementGetColumnSize', 'int64', [this.Ref, 'int'])
      this.statementBindInteger = this.lib.func('WCDBHandleStatementBindInteger', 'void', [this.Ref, 'int', 'int64'])
      this.statementBindDouble = this.lib.func('WCDBHandleStatementBindDouble', 'void', [this.Ref, 'int', 'double'])
      this.statementBindText = this.lib.func('WCDBHandleStatementBindText', 'void', [this.Ref, 'int', 'str'])
      this.statementBindBlob = this.lib.func('WCDBHandleStatementBindBlob', 'void', [this.Ref, 'int', 'uint8_t *', 'uint64'])
      this.statementBindNull = this.lib.func('WCDBHandleStatementBindNull', 'void', [this.Ref, 'int'])
      this.releaseCppObject = this.lib.func('WCDBReleaseCPPObject', 'void', ['void *'])
      return { success: true }
    } catch (error: any) {
      this.dispose()
      return { success: false, error: error?.message || String(error) }
    }
  }

  canOpen(dbPath: string, hexKey?: string): boolean {
    const probe = this.execQuery(
      dbPath,
      "SELECT count(*) AS table_count FROM sqlite_master WHERE type='table'",
      hexKey
    )
    return probe.success && !!probe.rows?.length
  }

  execQuery(dbPath: string, sql: string, hexKey?: string): OpenWcdbQueryResult {
    return this.execQueryWithParams(dbPath, sql, [], hexKey)
  }

  execQueryWithParams(
    dbPath: string,
    sql: string,
    params: OpenWcdbParam[],
    hexKey?: string
  ): OpenWcdbQueryResult {
    if (!this.lib) return { success: false, error: '开源 WCDB 尚未初始化' }
    if (!dbPath || !existsSync(dbPath)) return { success: false, error: `数据库不存在: ${dbPath}` }
    if (!sql.trim()) return { success: false, error: 'SQL 不能为空' }

    const database = this.createDatabase(dbPath, hexKey)
    if (!hasNativeRef(database)) return { success: false, error: '创建 WCDB 数据库对象失败' }

    let handle: NativeRef | null = null
    let statement: NativeRef | null = null
    try {
      if (!this.databaseCanOpen(database)) {
        return { success: false, error: '数据库打开失败：路径、密钥或 SQLCipher 参数不匹配' }
      }

      handle = this.databaseGetHandle(database, false)
      if (!hasNativeRef(handle)) return { success: false, error: '获取 WCDB 只读句柄失败' }
      statement = this.handleGetOrCreatePreparedSql(handle, sql)
      if (!hasNativeRef(statement)) return { success: false, error: 'SQL prepare 失败' }
      params.forEach((value, index) => this.bindValue(statement as NativeRef, index + 1, value))

      const rows: Array<Record<string, unknown>> = []
      while (this.statementStep(statement)) {
        if (this.statementIsDone(statement)) break
        rows.push(this.readRow(statement))
      }
      if (!this.statementIsDone(statement)) {
        return { success: false, error: 'SQL step 失败' }
      }
      return { success: true, rows }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    } finally {
      if (hasNativeRef(statement)) this.releaseCppObject(statement.innerValue)
      if (hasNativeRef(handle)) {
        this.handleFinalizeStatements(handle)
        this.releaseCppObject(handle.innerValue)
      }
      this.closeDatabase(database)
    }
  }

  private bindValue(statement: NativeRef, index: number, value: OpenWcdbParam): void {
    if (value === null || value === undefined) {
      this.statementBindNull(statement, index)
    } else if (typeof value === 'bigint') {
      this.statementBindInteger(statement, index, value)
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`参数 ${index} 不是有限数值`)
      if (Number.isInteger(value)) this.statementBindInteger(statement, index, value)
      else this.statementBindDouble(statement, index, value)
    } else if (typeof value === 'boolean') {
      this.statementBindInteger(statement, index, value ? 1 : 0)
    } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const bytes = Buffer.from(value)
      this.statementBindBlob(statement, index, bytes, bytes.length)
    } else {
      this.statementBindText(statement, index, String(value))
    }
  }

  private createDatabase(dbPath: string, hexKey?: string): NativeRef | null {
    const database = this.coreCreateDatabase(dbPath, true, false) as NativeRef
    if (!hasNativeRef(database)) return null
    if (hexKey) {
      const normalized = hexKey.trim()
      if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
        this.closeDatabase(database)
        throw new Error('数据库密钥必须是 64 位十六进制字符串')
      }
      const key = Buffer.from(normalized, 'hex')
      this.databaseConfigCipher(
        database,
        key,
        key.length,
        WECHAT_CIPHER_PAGE_SIZE,
        WCDB_CIPHER_VERSION_4
      )
    }
    return database
  }

  private readRow(statement: NativeRef): Record<string, unknown> {
    const row: Record<string, unknown> = {}
    const columnCount = Number(this.statementGetColumnCount(statement))
    for (let index = 0; index < columnCount; index += 1) {
      const name = String(this.statementGetColumnName(statement, index) || `column_${index}`)
      const type = Number(this.statementGetColumnType(statement, index))
      switch (type) {
        case WCDB_COLUMN_INTEGER:
          row[name] = normalizeInt64(this.statementGetInteger(statement, index))
          break
        case WCDB_COLUMN_FLOAT:
          row[name] = Number(this.statementGetDouble(statement, index))
          break
        case WCDB_COLUMN_STRING:
          row[name] = String(this.statementGetText(statement, index) ?? '')
          break
        case WCDB_COLUMN_BLOB: {
          const sizeValue = this.statementGetColumnSize(statement, index) as number | bigint
          const size = Number(sizeValue)
          const pointer = this.statementGetBlob(statement, index)
          if (!pointer || !Number.isSafeInteger(size) || size <= 0) {
            row[name] = ''
            break
          }
          const copied = this.koffi.decode(pointer, 'uint8_t', size)
          row[name] = Buffer.from(copied).toString('hex')
          break
        }
        case WCDB_COLUMN_NULL:
        default:
          row[name] = null
          break
      }
    }
    return row
  }

  private closeDatabase(database: NativeRef): void {
    if (!hasNativeRef(database)) return
    try { this.databaseClose(database, null, null) } catch { /* best effort */ }
    try { this.databasePurge(database) } catch { /* best effort */ }
    try { this.releaseCppObject(database.innerValue) } catch { /* best effort */ }
  }

  dispose(): void {
    this.lib = null
    this.koffi = null
    this.Ref = null
  }
}
