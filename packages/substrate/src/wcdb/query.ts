/**
 * Thin synchronous query surface over the WCDB bridge. Higher layers depend on this interface
 * (not on koffi) so they can be exercised with an in-memory fake in tests.
 */
import type { OpenWcdbBridge, SqlParam } from './openWcdbBridge'
import type { Row } from './rowDecoders'

export interface WcdbQuery {
  /** Run a SELECT; throws with the bridge error message on failure. */
  all(dbPath: string, sql: string, params?: SqlParam[]): Row[]
  get(dbPath: string, sql: string, params?: SqlParam[]): Row | undefined
  tableExists(dbPath: string, tableName: string): boolean
  /** Actual column names of a table (PRAGMA table_info). */
  columns(dbPath: string, tableName: string): string[]
  /** Table names matching a LIKE pattern. */
  tables(dbPath: string, likePattern?: string): string[]
}

/** Let the event loop breathe between shards / pages of synchronous native work. */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Quote an identifier for SQL (tables from sqlite_master, columns from PRAGMA). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function createBridgeQuery(bridge: OpenWcdbBridge, keyFor: (dbPath: string) => string | undefined): WcdbQuery {
  const columnCache = new Map<string, string[]>()
  const all = (dbPath: string, sql: string, params: SqlParam[] = []): Row[] => {
    const result = bridge.execQuery(dbPath, sql, params, keyFor(dbPath))
    if (!result.success) throw new Error(result.error || `数据库查询失败: ${sql.slice(0, 80)}`)
    return result.rows ?? []
  }
  return {
    all,
    get: (dbPath, sql, params) => all(dbPath, sql, params)[0],
    tableExists: (dbPath, tableName) =>
      all(dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND lower(name) = lower(?)", [tableName]).length > 0,
    columns: (dbPath, tableName) => {
      const key = `${dbPath}\0${tableName}`
      const cached = columnCache.get(key)
      if (cached) return cached
      const names = all(dbPath, `PRAGMA table_info(${quoteIdent(tableName)})`).map((r) => String(r['name'] ?? ''))
      columnCache.set(key, names)
      return names
    },
    tables: (dbPath, likePattern) =>
      (likePattern
        ? all(dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND lower(name) LIKE lower(?)", [likePattern])
        : all(dbPath, "SELECT name FROM sqlite_master WHERE type='table'")
      ).map((r) => String(r['name'] ?? '')),
  }
}
