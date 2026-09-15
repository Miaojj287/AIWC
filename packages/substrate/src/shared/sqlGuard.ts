/**
 * The read-only SQL guard for the audited query_sql escape hatch — the only one in the substrate.
 * SubstrateFacade.querySql runs it once; sources accept nothing but its branded result.
 *  - single statement, SELECT / WITH only (PRAGMA and EXPLAIN statements cannot be LIMIT-wrapped)
 *  - comments stripped, trailing ';' removed
 *  - forbidden keywords and pragma table-valued functions rejected, scanned outside string literals;
 *    quoted identifiers ("…", `…`, […]) stay visible to the scan, and a quote inside one never opens
 *    a string literal
 *  - LIMIT forced to <= SQL_MAX_LIMIT (clamped in place or wrapped)
 */
import type { Brand } from '@aiwc/protocol'
import { SubstrateError } from './errors'

export const SQL_MAX_LIMIT = 200

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint|release|truncate|grant|revoke|load_extension|writefile|readfile|zipfile|fts5_|analyze)\b|\breplace\b(?!\s*\()/i

/**
 * `pragma_<name>` table-valued functions run the pragma inside a SELECT (pragma_optimize runs ANALYZE,
 * a write). `\bpragma\b` cannot match them because `_` is a word character.
 */
const PRAGMA_FUNCTION = /\bpragma_\w+/i

/** SQLite also accepts a single-quoted string as a table name, so `FROM 'pragma_optimize'` reaches one. */
const PRAGMA_FUNCTION_LITERAL = /^pragma_\w+$/i

/** Closing delimiter per opening quote: string literal, then SQLite's three identifier quotes. */
const QUOTE_CLOSE: Readonly<Record<string, string>> = { "'": "'", '"': '"', '`': '`', '[': ']' }

/** A statement that passed guardSelectSql; only the guard creates one, so sources never run unchecked SQL. */
export type GuardedSql = Brand<{ readonly sql: string; readonly limit: number }, 'GuardedSql'>

interface LexedSql {
  /** The input without comments; string literals and quoted identifiers verbatim. */
  text: string
  /** `text` with string-literal contents blanked (same length), for statement and keyword scans. */
  scan: string
  /** Decoded contents of every string literal, in order. */
  literals: string[]
}

/** End (exclusive) of the quoted token opened at `start`. `''`, `""` and ``` `` ``` escape; `]` cannot. */
function quotedTokenEnd(sql: string, start: number, close: string): { end: number; closed: boolean } {
  const doubledEscapes = close !== ']'
  let i = start + 1
  while (i < sql.length) {
    if (sql[i] === close) {
      if (doubledEscapes && sql[i + 1] === close) {
        i += 2
        continue
      }
      return { end: i + 1, closed: true }
    }
    i++
  }
  return { end: sql.length, closed: false }
}

/** One pass over the statement with SQLite's token boundaries for comments, strings and identifiers. */
function lexSql(sql: string): LexedSql {
  let text = ''
  let scan = ''
  const literals: string[] = []
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      text += ' '
      scan += ' '
      continue
    }
    const close = QUOTE_CLOSE[c]
    if (close === undefined) {
      text += c
      scan += c
      i++
      continue
    }
    const { end, closed } = quotedTokenEnd(sql, i, close)
    const token = sql.slice(i, end)
    text += token
    if (c === "'") {
      const inner = token.slice(1, closed ? -1 : undefined)
      literals.push(inner.replace(/''/g, "'"))
      scan += `'${' '.repeat(inner.length)}${closed ? "'" : ''}`
    } else {
      scan += token
    }
    i = end
  }
  return { text, scan, literals }
}

/** Remove -- and /* *\/ comments while respecting string literals and quoted identifiers. */
export function stripSqlComments(sql: string): string {
  return lexSql(sql).text
}

/** stripSqlComments with string-literal contents replaced by spaces (same length as that result). */
export function blankSqlStrings(sql: string): string {
  return lexSql(sql).scan
}

const guarded = (sql: string, limit: number): GuardedSql => ({ sql, limit }) as GuardedSql

export function guardSelectSql(input: string, requestedLimit?: number, maxLimit: number = SQL_MAX_LIMIT): GuardedSql {
  if (typeof input !== 'string') throw new SubstrateError('sql_rejected', 'SQL 必须是字符串')
  const cleaned = stripSqlComments(input)
    .trim()
    .replace(/;+\s*$/u, '')
    .trim()
  if (!cleaned) throw new SubstrateError('sql_rejected', 'SQL 为空')

  // Lex the cleaned statement again so `sql` and `scan` come from one pass and stay index-aligned.
  const { text: sql, scan, literals } = lexSql(cleaned)
  if (scan.includes(';')) throw new SubstrateError('sql_rejected', '只允许单条语句')
  if (!/^(select|with)\b/i.test(scan)) throw new SubstrateError('sql_rejected', '只允许 SELECT 查询')
  const bad = FORBIDDEN.exec(scan) ?? PRAGMA_FUNCTION.exec(scan)
  const quotedPragma = literals.find((literal) => PRAGMA_FUNCTION_LITERAL.test(literal))
  const keyword = bad?.[0] ?? quotedPragma
  if (keyword !== undefined) {
    throw new SubstrateError('sql_rejected', `不允许的关键字：${keyword.trim().toUpperCase()}`)
  }

  const cap = Math.max(1, Math.floor(maxLimit))
  const wanted =
    requestedLimit === undefined || !Number.isFinite(requestedLimit) ? cap : Math.max(1, Math.floor(requestedLimit))
  const limit = Math.min(wanted, cap)

  const tail = /\blimit\s+(\d+)(?:\s+offset\s+(\d+))?\s*$/i.exec(scan)
  if (tail && tail.index !== undefined) {
    const existing = Number.parseInt(tail[1] ?? '', 10)
    const effective = Number.isFinite(existing) ? Math.min(existing, limit) : limit
    const offset = tail[2] ? ` OFFSET ${Number.parseInt(tail[2], 10)}` : ''
    return guarded(`${sql.slice(0, tail.index).trimEnd()} LIMIT ${effective}${offset}`, effective)
  }
  return guarded(`SELECT * FROM (${sql}) AS aiwc_q LIMIT ${limit}`, limit)
}
