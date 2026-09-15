import { describe, expect, it } from 'vitest'
import { chunk, formatDate, normalizeTable, parseDate, TableValidationError } from './table'

describe('normalizeTable', () => {
  it('coerces values by column type and collects select options', () => {
    const table = normalizeTable({
      title: '  项目待办 ',
      columns: [
        { name: '事项' },
        { name: '金额', type: 'number' },
        { name: '截止', type: 'date' },
        { name: '状态', type: 'select' },
        { name: '标签', type: 'multi_select' },
        { name: '已确认', type: 'checkbox' },
        { name: '链接', type: 'url' },
      ],
      rows: [
        {
          事项: '报价',
          金额: '1,200.5',
          截止: '2026/9/13 14:05',
          状态: '待办',
          标签: ['客户', '紧急'],
          已确认: '是',
          链接: 'https://example.com/a',
        },
        { 事项: '合同', 金额: 30, 截止: '2026-09-20', 状态: '完成', 标签: '客户', 已确认: false, 链接: 'not a url' },
      ],
    })
    expect(table.title).toBe('项目待办')
    expect(table.sheetName).toBe('数据')
    expect(table.rows[0]?.金额).toEqual({ type: 'number', value: 1200.5 })
    expect(table.rows[0]?.截止).toMatchObject({
      type: 'date',
      value: { y: 2026, m: 9, d: 13, hh: 14, mm: 5, hasTime: true },
    })
    expect(table.rows[1]?.截止).toMatchObject({ type: 'date', value: { hasTime: false } })
    expect(table.rows[0]?.已确认).toEqual({ type: 'checkbox', value: true })
    expect(table.rows[1]?.链接).toBeUndefined()
    expect(table.columns.find((c) => c.name === '状态')?.options).toEqual(['待办', '完成'])
    expect(table.columns.find((c) => c.name === '标签')?.options).toEqual(['客户', '紧急'])
    expect(table.warnings.some((w) => w.includes('链接'))).toBe(true)
  })

  it('writes a non-text first column as text and reports unknown keys', () => {
    const table = normalizeTable({
      title: 't',
      columns: [{ name: '日期', type: 'date' }, { name: 'x' }],
      rows: [{ 日期: '2026-01-01', y: 1 }],
    })
    expect(table.columns[0]?.type).toBe('text')
    expect(table.rows[0]?.日期).toEqual({ type: 'text', value: '2026-01-01' })
    expect(table.warnings.join('\n')).toMatch(/主字段/)
    expect(table.warnings.join('\n')).toMatch(/y/)
  })

  it('rejects empty titles, duplicate columns and oversized tables', () => {
    expect(() => normalizeTable({ title: ' ', columns: [{ name: 'a' }], rows: [] })).toThrow(TableValidationError)
    expect(() => normalizeTable({ title: 't', columns: [{ name: 'a' }, { name: 'a ' }], rows: [] })).toThrow(/重复/)
    expect(() => normalizeTable({ title: 't', columns: [], rows: [] })).toThrow(/至少/)
    expect(() =>
      normalizeTable({ title: 't', columns: [{ name: 'a' }], rows: Array.from({ length: 5001 }, () => ({ a: '1' })) }),
    ).toThrow(/上限/)
  })

  it('skips rows without any usable value', () => {
    const table = normalizeTable({
      title: 't',
      columns: [{ name: 'a' }, { name: 'n', type: 'number' }],
      rows: [{ a: '', n: 'abc' }, { a: 'ok' }],
    })
    expect(table.rows).toHaveLength(1)
    expect(table.warnings.join('\n')).toMatch(/1 行没有任何有效值/)
  })
})

describe('dates', () => {
  it('parses common shapes into China Standard Time wall clock', () => {
    expect(parseDate('2026年9月13日')).toMatchObject({ y: 2026, m: 9, d: 13, hasTime: false })
    expect(parseDate('2026-09-13T06:30:00Z')).toMatchObject({ d: 13, hh: 14, mm: 30, hasTime: true })
    expect(parseDate(Date.UTC(2026, 8, 12, 16, 0))).toMatchObject({ d: 13, hh: 0 })
    expect(parseDate('2026-02-30')).toBeUndefined()
    expect(parseDate('下周一')).toBeUndefined()
  })

  it('formats per platform needs', () => {
    const p = parseDate('2026-09-13 09:05:07')!
    expect(formatDate(p)).toBe('2026-09-13 09:05')
    expect(formatDate(p, { seconds: true })).toBe('2026-09-13 09:05:07')
    expect(formatDate(parseDate('2026-09-13')!, { seconds: true, forceTime: true })).toBe('2026-09-13 00:00:00')
  })
})

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
