import { describe, expect, it } from 'vitest'
import { inlineText, type MarkdownInline } from './inline'
import { parseMarkdown, type MarkdownBlock, type MarkdownTable } from './parse'

const text = (value: string): MarkdownInline => ({ type: 'text', text: value })
const para = (...children: MarkdownInline[]): MarkdownBlock => ({ type: 'paragraph', children })

function onlyTable(source: string): MarkdownTable {
  const blocks = parseMarkdown(source)
  const table = blocks.find((b): b is MarkdownTable => b.type === 'table')
  if (!table) throw new Error(`no table in ${JSON.stringify(blocks)}`)
  return table
}

const cellTexts = (table: MarkdownTable) => ({
  header: table.header.map((cell) => inlineText(cell.children)),
  rows: table.rows.map((row) => row.map((cell) => inlineText(cell.children))),
})

describe('parseMarkdown — Agent replies', () => {
  it('parses headings, paragraphs, lists, quotes, rules and fenced code', () => {
    const src = [
      '# 标题',
      '',
      '第一段 **重点** 和 `code`。',
      '继续同一段。',
      '',
      '- 甲',
      '- 乙 *斜体*',
      '',
      '1. one',
      '2. two',
      '',
      '> 引用',
      '',
      '---',
      '',
      '```json',
      '{ "a": 1 }',
      '```',
      '尾段',
    ].join('\n')
    expect(parseMarkdown(src)).toEqual([
      { type: 'heading', level: 1, children: [text('标题')] },
      para(
        text('第一段 '),
        { type: 'strong', children: [text('重点')] },
        text(' 和 '),
        { type: 'code', text: 'code' },
        text('。\n继续同一段。'),
      ),
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [[para(text('甲'))], [para(text('乙 '), { type: 'em', children: [text('斜体')] })]],
      },
      { type: 'list', ordered: true, start: 1, items: [[para(text('one'))], [para(text('two'))]] },
      { type: 'quote', children: [para(text('引用'))] },
      { type: 'rule' },
      { type: 'code', lang: 'json', code: '{ "a": 1 }' },
      para(text('尾段')),
    ])
  })

  it('keeps an unterminated fence as code while streaming', () => {
    expect(parseMarkdown('```ts\nconst a = 1')).toEqual([{ type: 'code', lang: 'ts', code: 'const a = 1' }])
    expect(parseMarkdown('说明\n```')).toEqual([para(text('说明')), { type: 'code', code: '' }])
  })

  it('closes a fence only with a bare run at least as long as the opener', () => {
    const src = ['````md', '```js', 'x', '```', '````', '后文'].join('\n')
    expect(parseMarkdown(src)).toEqual([{ type: 'code', lang: 'md', code: '```js\nx\n```' }, para(text('后文'))])
  })

  it('continues a list item with lines indented under it (lazy continuation) and ends the list at unindented text', () => {
    const src = ['1. **标题**', '   说明文字', '2. 第二项', '总结：完'].join('\n')
    expect(parseMarkdown(src)).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [[para({ type: 'strong', children: [text('标题')] }, text('\n说明文字'))], [para(text('第二项'))]],
      },
      para(text('总结：完')),
    ])
  })

  it('keeps blank-separated items in one list and code indented under an item inside it', () => {
    const src = ['1. 安装：', '   ```bash', '   npm i', '', '   npm run dev', '   ```', '', '2. 运行'].join('\n')
    const [list, ...rest] = parseMarkdown(src)
    expect(rest).toEqual([])
    expect(list).toEqual({
      type: 'list',
      ordered: true,
      start: 1,
      items: [
        [para(text('安装：')), { type: 'code', lang: 'bash', code: 'npm i\n\nnpm run dev' }],
        [para(text('运行'))],
      ],
    })
  })

  it('reads `- - -` as a rule, `# C#` as a heading and a year in a sentence as text', () => {
    expect(parseMarkdown('- - -')).toEqual([{ type: 'rule' }])
    expect(parseMarkdown('# C#')).toEqual([{ type: 'heading', level: 1, children: [text('C#')] }])
    expect(parseMarkdown('#标签')).toEqual([para(text('#标签'))])
  })
})

describe('parseMarkdown — Markdown files', () => {
  it('parses headings, paragraphs, hr, quotes and fenced code', () => {
    const src = [
      '# 标题',
      '',
      '第一段',
      '继续',
      '',
      '---',
      '> 引用',
      '> 第二行',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n')
    const blocks = parseMarkdown(src)
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, children: [text('标题')] })
    // One paragraph across the two lines; the soft break stays "\n" for the surface to show or collapse.
    expect(blocks[1]).toEqual(para(text('第一段\n继续')))
    expect(blocks[2]).toEqual({ type: 'rule' })
    expect(blocks[3]).toEqual({ type: 'quote', children: [para(text('引用\n第二行'))] })
    expect(blocks[4]).toEqual({ type: 'code', lang: 'ts', code: 'const a = 1' })
  })

  it('parses nested and ordered lists', () => {
    const src = ['- a', '  - a1', '  - a2', '- b', '', '3. x', '4. y'].join('\n')
    const [ul, ol] = parseMarkdown(src)
    expect(ul).toMatchObject({ type: 'list', ordered: false })
    if (ul?.type !== 'list') throw new Error('expected list')
    expect(ul.items).toHaveLength(2)
    expect(ul.items[0]?.[0]).toEqual(para(text('a')))
    expect(ul.items[0]?.[1]).toMatchObject({ type: 'list', items: [[para(text('a1'))], [para(text('a2'))]] })
    expect(ol).toMatchObject({ type: 'list', ordered: true, start: 3 })
  })

  it('parses pipe tables with alignment', () => {
    const table = onlyTable(['| 名称 | 数量 |', '|:--|--:|', '| 苹果 | 3 |', '| 梨 | 12 |'].join('\n'))
    expect(table.align).toEqual(['left', 'right'])
    expect(cellTexts(table)).toEqual({
      header: ['名称', '数量'],
      rows: [
        ['苹果', '3'],
        ['梨', '12'],
      ],
    })
  })

  it('hard line breaks with two trailing spaces', () => {
    expect(parseMarkdown('一行  \n二行')).toEqual([para(text('一行'), { type: 'break' }, text('二行'))])
  })

  it('an unterminated fence swallows to EOF without throwing', () => {
    expect(parseMarkdown('```\nabc')).toEqual([{ type: 'code', lang: undefined, code: 'abc' }])
  })

  it('a quote holds blocks', () => {
    expect(parseMarkdown('> # 题\n> - 甲\n> - 乙')).toEqual([
      {
        type: 'quote',
        children: [
          { type: 'heading', level: 1, children: [text('题')] },
          { type: 'list', ordered: false, start: 1, items: [[para(text('甲'))], [para(text('乙'))]] },
        ],
      },
    ])
  })
})

describe('parseMarkdown — tables', () => {
  it('reads every alignment, with or without outer pipes', () => {
    expect(onlyTable('a | b | c | d\n:-- | :-: | --: | ---\n1 | 2 | 3 | 4').align).toEqual([
      'left',
      'center',
      'right',
      undefined,
    ])
  })

  it('parses inline formatting in cells and keeps each cell as written', () => {
    const table = onlyTable('| 项目 | 说明 |\n|---|---|\n| **甲** | `npm i` 和 [文档](https://x.y) |')
    expect(table.rows[0]?.[0]).toEqual({ source: '**甲**', children: [{ type: 'strong', children: [text('甲')] }] })
    expect(table.rows[0]?.[1]?.children).toEqual([
      { type: 'code', text: 'npm i' },
      text(' 和 '),
      { type: 'link', href: 'https://x.y', children: [text('文档')] },
    ])
  })

  it('treats \\| as a pipe inside a cell, code spans included', () => {
    const table = onlyTable('| 表达式 | 含义 |\n|---|---|\n| `a \\| b` | 甲\\|乙 |')
    expect(cellTexts(table).rows).toEqual([['a | b', '甲|乙']])
    expect(table.rows[0]?.[0]?.source).toBe('`a \\| b`')
  })

  it('pads short rows and drops extra cells (ragged rows)', () => {
    const table = onlyTable('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |\n|  | 2 |')
    expect(cellTexts(table).rows).toEqual([
      ['1', '', ''],
      ['1', '2', '3'],
      ['', '2', ''],
    ])
    expect(table.rows.every((row) => row.length === 3)).toBe(true)
  })

  it('needs a delimiter row with as many cells as the header', () => {
    expect(parseMarkdown('| a | b |\n|---|').some((b) => b.type === 'table')).toBe(false)
    expect(parseMarkdown('a | b\n---')).toEqual([para(text('a | b')), { type: 'rule' }])
  })

  it('ends at a blank line, a line without a pipe, or another block, and may follow a paragraph directly', () => {
    const src = ['下面是对比：', '| a | b |', '|---|---|', '| 1 | 2 |', '总结', '', '| c |', '| - |', '- 列表'].join(
      '\n',
    )
    const blocks = parseMarkdown(src)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'table', 'paragraph', 'table', 'list'])
    expect(blocks[0]).toEqual(para(text('下面是对比：')))
    expect(blocks[2]).toEqual(para(text('总结')))
  })

  it('works inside a list item and a quote', () => {
    const [list] = parseMarkdown('- 成绩：\n  | 名 | 分 |\n  |---|--:|\n  | 甲 | 90 |')
    expect(list).toMatchObject({
      type: 'list',
      items: [[{ type: 'paragraph' }, { type: 'table', align: [undefined, 'right'] }]],
    })
    const [quote] = parseMarkdown('> | a |\n> |---|\n> | 1 |')
    expect(quote).toMatchObject({ type: 'quote', children: [{ type: 'table' }] })
  })
})

describe('parseMarkdown — a table while it streams', () => {
  const steps = [
    '| 名称 | 数量 |',
    '| 名称 | 数量 |\n',
    '| 名称 | 数量 |\n|',
    '| 名称 | 数量 |\n|--',
    '| 名称 | 数量 |\n|---|-',
    '| 名称 | 数量 |\n|---|--:|',
    '| 名称 | 数量 |\n|---|--:|\n| 苹',
    '| 名称 | 数量 |\n|---|--:|\n| 苹果 | 3',
    '| 名称 | 数量 |\n|---|--:|\n| 苹果 | 3 |\n|',
  ]

  it('never throws on any prefix of a table', () => {
    const full = steps[steps.length - 1] ?? ''
    for (let n = 0; n <= full.length; n++) expect(() => parseMarkdown(full.slice(0, n))).not.toThrow()
  })

  it('reads as a paragraph until the delimiter row is complete, then as a table', () => {
    for (const step of steps.slice(0, 4)) {
      const blocks = parseMarkdown(step)
      expect(blocks.map((b) => b.type)).toEqual(['paragraph'])
    }
    expect(parseMarkdown(steps[4] ?? '').map((b) => b.type)).toEqual(['table'])
    expect(cellTexts(onlyTable(steps[5] ?? ''))).toEqual({ header: ['名称', '数量'], rows: [] })
    expect(cellTexts(onlyTable(steps[6] ?? '')).rows).toEqual([['苹', '']])
    expect(cellTexts(onlyTable(steps[7] ?? '')).rows).toEqual([['苹果', '3']])
  })
})
