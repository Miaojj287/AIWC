/**
 * Read-only SQL guard for the audited query_sql escape hatch.
 *  - single statement, SELECT / WITH only
 *  - comments stripped, trailing ';' removed
 *  - forbidden keywords rejected (scanned outside string literals)
 *  - LIMIT forced to <= SQL_MAX_LIMIT (clamped in place or wrapped)
 */
import { SubstrateError } from './errors'

export const SQL_MAX_LIMIT = 200

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint|release|truncate|grant|revoke|load_extension|writefile|readfile|zipfile|fts5_|analyze)\b|\breplace\b(?!\s*\()/i

/** Remove -- and /* *\/ comments while respecting single-quoted string literals. */
export function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  let inString = false
  while (i < sql.length) {
    const c = sql[i]!
    const next = sql[i + 1]
    if (inString) {
      out += c
      if (c === "'") {
        if (next === "'") {
          out += next
          i += 2
          continue
        }
        inString = false
      }
      i++
      continue
    }
    if (c === "'") {
      inString = true
      out += c
      i++
      continue
    }
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

/** Replace the contents of string literals with spaces (same length) so keyword scans and index maths stay aligned. */
export function blankSqlStrings(sql: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!
    if (inString) {
      if (c === "'") {
        if (sql[i + 1] === "'") {
          out += '  '
          i++
          continue
        }
        inString = false
        out += c
      } else out += ' '
      continue
    }
    if (c === "'") inString = true
    out += c
  }
  return out
}

export interface GuardedSql {
  sql: string
  limit: number
}

export function guardSelectSql(input: string, requestedLimit?: number, maxLimit: number = SQL_MAX_LIMIT): GuardedSql {
  if (typeof input !== 'string') throw new SubstrateError('sql_rejected', 'SQL 必须是字符串')
  let sql = stripSqlComments(input).trim()
  sql = sql.replace(/;+\s*$/u, '').trim()
  if (!sql) throw new SubstrateError('sql_rejected', 'SQL 为空')

  const scan = blankSqlStrings(sql)
  if (scan.includes(';')) throw new SubstrateError('sql_rejected', '只允许单条语句')
  if (!/^(select|with)\b/i.test(scan)) throw new SubstrateError('sql_rejected', '只允许 SELECT 查询')
  const bad = FORBIDDEN.exec(scan)
  if (bad) throw new SubstrateError('sql_rejected', `不允许的关键字：${bad[0].trim().toUpperCase()}`)

  const cap = Math.max(1, Math.floor(maxLimit))
  const wanted = requestedLimit === undefined || !Number.isFinite(requestedLimit) ? cap : Math.max(1, Math.floor(requestedLimit))
  const limit = Math.min(wanted, cap)

  const tail = /\blimit\s+(\d+)(?:\s+offset\s+(\d+))?\s*$/i.exec(scan)
  if (tail && tail.index !== undefined) {
    const existing = Number.parseInt(tail[1] ?? '', 10)
    const effective = Number.isFinite(existing) ? Math.min(existing, limit) : limit
    const offset = tail[2] ? ` OFFSET ${Number.parseInt(tail[2], 10)}` : ''
    return { sql: `${sql.slice(0, tail.index).trimEnd()} LIMIT ${effective}${offset}`, limit: effective }
  }
  return { sql: `SELECT * FROM (${sql}) AS aiwc_q LIMIT ${limit}`, limit }
}
