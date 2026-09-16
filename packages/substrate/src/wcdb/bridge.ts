/**
 * The query surface shared by both database engines: the koffi/WCDB bridge (needs a WCDB build in
 * `resources/native/<platform>-<arch>/`) and the pure-TypeScript SQLCipher engine (used wherever that
 * build is absent, e.g. Windows). Higher layers depend on this interface only, so no engine detail
 * leaks into the query code.
 */
import type { Row } from './rowDecoders'

export type SqlParam = string | number | bigint | boolean | null | undefined | Buffer | Uint8Array

export type WcdbLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface WcdbQueryResult {
  success: boolean
  rows?: Row[]
  error?: string
}

export interface WcdbBridge {
  /** True when the database opens with this key (also warms the engine's per-database caches). */
  canOpen(dbPath: string, hexKey?: string): boolean
  /** Run one read-only statement. Never throws: failures come back as `{ success: false, error }`. */
  execQuery(dbPath: string, sql: string, params?: SqlParam[], hexKey?: string): WcdbQueryResult
  /** Drop one cached database (e.g. after a corruption error) or all of them. */
  closeDatabase(dbPath?: string): void
  /** Release every handle. The bridge is unusable afterwards. */
  dispose(): void
}

/** Int64 columns overflow JS numbers in WeChat data (server ids): keep precision as a string. */
export function normalizeInt64(value: number | bigint): number | string {
  if (typeof value === 'number') return value
  if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(value)
  return value.toString()
}
