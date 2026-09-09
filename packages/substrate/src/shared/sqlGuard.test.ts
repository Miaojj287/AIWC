import { describe, expect, it } from 'vitest'
import { guardSelectSql, stripSqlComments, blankSqlStrings, SQL_MAX_LIMIT } from './sqlGuard'
import { SubstrateError } from './errors'

describe('guardSelectSql', () => {
  it('rejects non-SELECT statements and forbidden keywords', () => {
    expect(() => guardSelectSql('UPDATE messages SET text = 1')).toThrow(SubstrateError)
    expect(() => guardSelectSql('DELETE FROM messages')).toThrow(/只允许 SELECT/)
    expect(() => guardSelectSql('SELECT 1; DROP TABLE messages')).toThrow(/单条语句/)
    expect(() => guardSelectSql("SELECT * FROM messages WHERE x = 'a'; PRAGMA key = 'b'")).toThrow()
    expect(() => guardSelectSql('SELECT load_extension("x")')).toThrow(/关键字/)
    expect(() => guardSelectSql('WITH t AS (SELECT 1) INSERT INTO a SELECT * FROM t')).toThrow(/INSERT/)
    expect(() => guardSelectSql('')).toThrow(/为空/)
    expect(() => guardSelectSql('-- only a comment')).toThrow()
  })

  it('allows keywords inside string literals and replace() as a function', () => {
    const g = guardSelectSql("SELECT replace(text, 'DELETE', 'x') AS t FROM messages WHERE text LIKE '%update%'")
    expect(g.sql).toContain('LIMIT 200')
    expect(g.limit).toBe(SQL_MAX_LIMIT)
  })

  it('adds a LIMIT when missing, clamps an existing one and strips trailing semicolons', () => {
    const added = guardSelectSql('SELECT * FROM messages;')
    expect(added.sql).toBe('SELECT * FROM (SELECT * FROM messages) AS aiwc_q LIMIT 200')
    const clamped = guardSelectSql('SELECT * FROM messages ORDER BY seq LIMIT 5000')
    expect(clamped.sql).toBe('SELECT * FROM messages ORDER BY seq LIMIT 200')
    expect(clamped.limit).toBe(200)
    const kept = guardSelectSql('SELECT * FROM messages LIMIT 5 OFFSET 10', 50)
    expect(kept.sql).toBe('SELECT * FROM messages LIMIT 5 OFFSET 10')
    const requested = guardSelectSql('SELECT * FROM messages', 20)
    expect(requested.sql.endsWith('LIMIT 20')).toBe(true)
    const tooBig = guardSelectSql('SELECT * FROM messages', 999)
    expect(tooBig.limit).toBe(200)
    const cte = guardSelectSql('WITH t AS (SELECT 1 AS a) SELECT a FROM t')
    expect(cte.sql.startsWith('SELECT * FROM (WITH t AS')).toBe(true)
  })

  it('strips comments while keeping strings intact', () => {
    expect(stripSqlComments("SELECT 'a--b' /* c */ -- tail\nFROM t")).toBe("SELECT 'a--b'   \nFROM t")
    expect(blankSqlStrings("SELECT 'it''s' FROM t")).toBe("SELECT '     ' FROM t")
  })
})
