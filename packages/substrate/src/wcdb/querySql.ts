/**
 * Guard for the audited `query_sql` tool: a single read-only SELECT/WITH statement, no side effects.
 */

const FORBIDDEN = /\b(ATTACH|DETACH|PRAGMA|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|LOAD_EXTENSION|WRITEFILE|READFILE|EDIT)\b/i

/** Remove comments and string literals so keyword checks cannot be fooled by quoted text. */
export function stripSqlNoise(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i] ?? ''
    const next = sql[i + 1] ?? ''
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === close) {
          if (sql[j + 1] === close && close !== ']') {
            j += 2
            continue
          }
          break
        }
        j++
      }
      out += ch === '"' || ch === '`' || ch === '[' ? sql.slice(i, Math.min(j + 1, sql.length)) : "''"
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Returns the trimmed statement (without trailing semicolon) or throws a user-facing error. */
export function assertReadOnlySql(sql: string): string {
  const cleaned = stripSqlNoise(String(sql ?? '')).trim().replace(/;+\s*$/, '').trim()
  if (!cleaned) throw new Error('SQL 不能为空')
  if (cleaned.includes(';')) throw new Error('只允许执行单条语句')
  if (!/^(SELECT|WITH)\b/i.test(cleaned)) throw new Error('只允许 SELECT 查询')
  const forbidden = FORBIDDEN.exec(cleaned)
  if (forbidden) throw new Error(`不允许的关键字: ${forbidden[1]?.toUpperCase()}`)
  return String(sql).trim().replace(/;+\s*$/, '').trim()
}

/** Wrap a validated statement so the row count is bounded regardless of the user's own LIMIT. */
export function wrapWithLimit(sql: string, limit: number): string {
  const safeLimit = Math.max(1, Math.min(10_000, Math.floor(limit) || 200))
  return `SELECT * FROM (${sql}) AS __q LIMIT ${safeLimit}`
}
