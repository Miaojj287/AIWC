import { describe, expect, it } from 'vitest'
import { guardSelectSql, stripSqlComments, blankSqlStrings, SQL_MAX_LIMIT, type GuardedSql } from './sqlGuard'
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
    expect(guardSelectSql("SELECT ';' AS s, 'DROP TABLE x' AS t").sql).toContain("';'")
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

  it('treats quoted identifiers as identifiers, not as strings or comments', () => {
    expect(stripSqlComments('SELECT "a--b", [c/*d], `e--f` FROM t')).toBe('SELECT "a--b", [c/*d], `e--f` FROM t')
    expect(blankSqlStrings(`SELECT "it's", [x'y], \`z'w\` FROM t WHERE a = 'q'`)).toBe(
      `SELECT "it's", [x'y], \`z'w\` FROM t WHERE a = ' '`,
    )
    expect(guardSelectSql('SELECT "a--b" AS x, [c/*d] FROM t').sql).toBe(
      'SELECT * FROM (SELECT "a--b" AS x, [c/*d] FROM t) AS aiwc_q LIMIT 200',
    )
  })

  it('does not let a quote inside an identifier hide a second statement or a forbidden call', () => {
    // An apostrophe inside "…" / […] / `…` must not open a string literal that blanks the rest.
    expect(() => guardSelectSql(`SELECT "it's" FROM t) ; DROP TABLE t; SELECT * FROM (SELECT 1 /*'*/`)).toThrow(
      /单条语句/,
    )
    expect(() => guardSelectSql("SELECT [it's] FROM t WHERE load_extension('x') OR 'a' LIMIT 5")).toThrow(/关键字/)
    expect(() => guardSelectSql("SELECT `it's` FROM t WHERE readfile('x') OR 'a' LIMIT 5")).toThrow(/关键字/)
    expect(() => guardSelectSql(`SELECT "load_extension"('x')`)).toThrow(/关键字/)
  })

  it('rejects PRAGMA / EXPLAIN statements and pragma table-valued functions however they are quoted', () => {
    for (const sql of ['PRAGMA table_info(messages)', 'EXPLAIN SELECT 1', 'EXPLAIN QUERY PLAN SELECT 1']) {
      expect(() => guardSelectSql(sql), sql).toThrow(/只允许 SELECT/)
    }
    // pragma_optimize(…) runs ANALYZE — a write — from inside a SELECT.
    for (const sql of [
      'SELECT * FROM pragma_optimize(0x10002)',
      "SELECT * FROM main.pragma_table_info('messages')",
      'SELECT * FROM "pragma_optimize"',
      'SELECT * FROM [PRAGMA_OPTIMIZE]',
      "SELECT * FROM 'pragma_optimize'(0x10002)",
    ]) {
      expect(() => guardSelectSql(sql), sql).toThrow(/关键字/)
    }
    expect(guardSelectSql("SELECT text FROM messages WHERE text = 'pragma_optimize is a word'").limit).toBe(200)
  })

  it('returns the checked statement with its row cap as the branded type sources accept', () => {
    const checked: GuardedSql = guardSelectSql('SELECT 1', 5)
    expect(checked).toEqual({ sql: 'SELECT * FROM (SELECT 1) AS aiwc_q LIMIT 5', limit: 5 })
  })
})
