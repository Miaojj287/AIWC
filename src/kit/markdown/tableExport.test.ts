import { describe, expect, it } from 'vitest'
import { parseMarkdown, type MarkdownTable } from './parse'
import { tableToCsv, tableToMarkdown, tableToTsv } from './tableExport'

function table(source: string): MarkdownTable {
  const found = parseMarkdown(source).find((b): b is MarkdownTable => b.type === 'table')
  if (!found) throw new Error('no table')
  return found
}

const SALES = table(
  [
    '| 商品 | 备注 | 金额 |',
    '|:--|:-:|--:|',
    '| **苹果** | 产地 [山东](https://x.y)，"红富士" | 1,234.5 |',
    '| 梨 | `a \\| b` | -5 |',
    '| 西瓜 |',
  ].join('\n'),
)

describe('tableToMarkdown', () => {
  it('writes each cell as it was written, keeps alignment and pads short rows', () => {
    expect(tableToMarkdown(SALES)).toBe(
      [
        '| 商品 | 备注 | 金额 |',
        '| :-- | :-: | --: |',
        '| **苹果** | 产地 [山东](https://x.y)，"红富士" | 1,234.5 |',
        '| 梨 | `a \\| b` | -5 |',
        '| 西瓜 |  |  |',
      ].join('\n'),
    )
  })

  it('round-trips: the copied Markdown parses back to the same table', () => {
    const again = table(tableToMarkdown(SALES))
    expect(again.align).toEqual(SALES.align)
    expect(again.rows.map((row) => row.map((cell) => cell.source))).toEqual(
      SALES.rows.map((row) => row.map((cell) => cell.source)),
    )
  })
})

describe('tableToTsv', () => {
  it('copies the plain text of every cell, tab-separated, quoting a field that holds a quote', () => {
    expect(tableToTsv(SALES)).toBe(
      ['商品\t备注\t金额', '苹果\t"产地 山东，""红富士"""\t1,234.5', '梨\ta | b\t-5', '西瓜\t\t'].join('\n'),
    )
  })

  it('reduces an evidence citation to its label', () => {
    const cited = table('| 原话 | 出处 |\n|---|---|\n| “好的” | [02-14 19:28](wx://wxid_a/m1) |')
    expect(tableToTsv(cited).split('\n')[1]).toBe('“好的”\t02-14 19:28')
  })
})

describe('tableToCsv', () => {
  it('follows RFC 4180: CRLF rows, quoted fields for commas, quotes and line breaks', () => {
    expect(tableToCsv(SALES)).toBe(
      ['商品,备注,金额', '苹果,"产地 山东，""红富士""","1,234.5"', '梨,a | b,-5', '西瓜,,', ''].join('\r\n'),
    )
  })

  it('neutralises cells a spreadsheet would run as formulas, but not plain numbers', () => {
    const risky = table(
      '| 内容 |\n|---|\n| =HYPERLINK("http://evil.example","点我") |\n| +86 138 |\n| @SUM(A1) |\n| -12% |\n| +3.5 |',
    )
    expect(tableToCsv(risky).split('\r\n').slice(1, -1)).toEqual([
      `"'=HYPERLINK(""http://evil.example"",""点我"")"`,
      "'+86 138",
      "'@SUM(A1)",
      '-12%',
      '+3.5',
    ])
    expect(tableToTsv(risky).split('\n')[2]).toBe("'+86 138")
  })
})
