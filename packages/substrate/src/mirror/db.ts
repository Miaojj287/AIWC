/**
 * Thin wrapper over node:sqlite DatabaseSync: statement cache, parameter coercion, nested-safe
 * transactions. Everything in the mirror goes through this so the SQL surface stays in one place.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type SqlParam = string | number | bigint | boolean | null | undefined | Uint8Array
export type Row = Record<string, unknown>

function coerce(p: SqlParam): SQLInputValue {
  if (p === undefined) return null
  if (typeof p === 'boolean') return p ? 1 : 0
  return p
}

export class Db {
  readonly raw: DatabaseSync
  readonly path: string
  private readonly cache = new Map<string, StatementSync>()
  private txDepth = 0

  constructor(path: string) {
    if (path !== ':memory:' && !path.startsWith('file:')) mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.path = path
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
    return this.stmt(sql).all(...params.map(coerce)) as unknown as T[]
  }

  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.stmt(sql).get(...params.map(coerce)) as unknown as T | undefined
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params.map(coerce))
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  /** Run `fn` inside a transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++
      try {
        return fn()
      } finally {
        this.txDepth--
      }
    }
    this.raw.exec('BEGIN IMMEDIATE')
    this.txDepth = 1
    try {
      const out = fn()
      this.raw.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw err
    } finally {
      this.txDepth = 0
    }
  }

  close(): void {
    this.cache.clear()
    try {
      this.raw.close()
    } catch {
      /* already closed */
    }
  }
}

/** `?, ?, ?` for IN (...) clauses. */
export function placeholders(n: number): string {
  return Array.from({ length: Math.max(0, n) }, () => '?').join(', ')
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

export function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  return typeof v === 'string' ? v : String(v)
}
