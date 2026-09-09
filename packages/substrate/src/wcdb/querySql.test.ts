import { describe, expect, it } from 'vitest'
import { assertReadOnlySql, stripSqlNoise, wrapWithLimit } from './querySql'

describe('assertReadOnlySql', () => {
  it('allows a single SELECT / WITH', () => {
    expect(assertReadOnlySql('SELECT * FROM contact')).toBe('SELECT * FROM contact')
    expect(assertReadOnlySql('WITH t AS (SELECT 1) SELECT * FROM t')).toContain('WITH')
    expect(assertReadOnlySql('  select 1 ;  ')).toBe('select 1')
  })
  it('rejects writes and DDL', () => {
    expect(() => assertReadOnlySql('DELETE FROM contact')).toThrow()
    expect(() => assertReadOnlySql('UPDATE t SET a=1')).toThrow()
    expect(() => assertReadOnlySql('DROP TABLE t')).toThrow()
    expect(() => assertReadOnlySql('PRAGMA table_info(x)')).toThrow()
    expect(() => assertReadOnlySql('ATTACH DATABASE x AS y')).toThrow()
  })
  it('rejects multiple statements', () => {
    expect(() => assertReadOnlySql('SELECT 1; DROP TABLE t')).toThrow('单条')
  })
  it('is not fooled by keywords inside string literals', () => {
    expect(assertReadOnlySql("SELECT * FROM t WHERE name = 'DROP TABLE x'")).toContain('SELECT')
    expect(assertReadOnlySql("SELECT ';' AS s")).toContain('SELECT')
  })
  it('rejects empty input', () => {
    expect(() => assertReadOnlySql('   ')).toThrow()
  })
})

describe('stripSqlNoise', () => {
  it('removes comments', () => {
    expect(stripSqlNoise('SELECT 1 -- comment\nFROM t')).not.toContain('comment')
    expect(stripSqlNoise('SELECT /* x */ 1')).not.toContain('x')
  })
})

describe('wrapWithLimit', () => {
  it('bounds the row count', () => {
    expect(wrapWithLimit('SELECT * FROM t', 50)).toBe('SELECT * FROM (SELECT * FROM t) AS __q LIMIT 50')
    expect(wrapWithLimit('SELECT 1', 0)).toContain('LIMIT 200')
    expect(wrapWithLimit('SELECT 1', 99999)).toContain('LIMIT 10000')
  })
})
