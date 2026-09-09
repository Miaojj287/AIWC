import { describe, expect, it } from 'vitest'
import { MEMORY_FILES, budgetRatio, compact, isMemoryFile, memoryFileName, memoryStatusLine, overBudget, parseMaxEntries } from './memoryModel'

describe('memoryModel', () => {
  it('lists the four bounded files', () => {
    expect(MEMORY_FILES.map((m) => m.file)).toEqual(['MEMORY', 'USER', 'SOUL', 'AGENTS'])
    expect(memoryFileName('SOUL')).toBe('SOUL.md')
    expect(isMemoryFile('USER')).toBe(true)
    expect(isMemoryFile('NOPE')).toBe(false)
  })
  it('computes budget ratios and status lines', () => {
    expect(budgetRatio(undefined)).toBe(0)
    expect(budgetRatio({ file: 'MEMORY', usedChars: 4000, limitChars: 8000 })).toBe(0.5)
    expect(budgetRatio({ file: 'MEMORY', usedChars: 9000, limitChars: 8000 })).toBe(1)
    expect(memoryStatusLine(12, { file: 'MEMORY', usedChars: 1234, limitChars: 8000 })).toBe('12 条 · 已用 1.2k / 8k 字')
    expect(memoryStatusLine(undefined, undefined)).toBe('读取中…')
    expect(compact(999)).toBe('999')
    expect(compact(20_000)).toBe('2万')
  })
  it('validates the entry cap', () => {
    expect(parseMaxEntries('200')).toEqual({ ok: true, value: 200 })
    expect(parseMaxEntries('5')).toEqual({ ok: false, error: '范围 10 – 2000' })
    expect(parseMaxEntries('abc').ok).toBe(false)
    expect(parseMaxEntries(' 2000 ')).toEqual({ ok: true, value: 2000 })
  })
  it('flags over-budget content', () => {
    expect(overBudget('abc', { file: 'USER', usedChars: 0, limitChars: 2 })).toBe(true)
    expect(overBudget('abc', { file: 'USER', usedChars: 0, limitChars: 3 })).toBe(false)
    expect(overBudget('abc', undefined)).toBe(false)
  })
})
