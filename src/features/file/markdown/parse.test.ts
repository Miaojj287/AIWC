import { describe, expect, it } from 'vitest'
import { inlineText, parseInline, parseMarkdown } from './parse'

describe('parseInline', () => {
  it('handles strong / em / code / links / autolinks / escapes', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.y) https://z.w. \\*f\\*')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.y', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://z.w', c: [{ t: 'text', v: 'https://z.w' }] },
      { t: 'text', v: '. *f*' },
    ])
  })
  it('renders images as their alt text link and leaves stray markers alone', () => {
    expect(parseInline('![图](a.png) 2 * 3 = 6_x')).toEqual([
      { t: 'link', href: 'a.png', c: [{ t: 'text', v: '图' }] },
      { t: 'text', v: ' 2 * 3 = 6_x' },
    ])
    expect(inlineText(parseInline('**a** `b`'))).toBe('a b')
  })
})

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, hr, quotes and fenced code', () => {
    const src = ['# 标题', '', '第一段', '继续', '', '---', '> 引用', '> 第二行', '', '```ts', 'const a = 1', '```'].join('\n')
    const blocks = parseMarkdown(src)
    expect(blocks[0]).toEqual({ t: 'heading', level: 1, c: [{ t: 'text', v: '标题' }] })
    expect(blocks[1]).toEqual({ t: 'paragraph', c: [{ t: 'text', v: '第一段 继续' }] })
    expect(blocks[2]).toEqual({ t: 'hr' })
    expect(blocks[3]).toEqual({ t: 'quote', c: [{ t: 'paragraph', c: [{ t: 'text', v: '引用 第二行' }] }] })
    expect(blocks[4]).toEqual({ t: 'code', lang: 'ts', v: 'const a = 1' })
  })
  it('parses nested and ordered lists', () => {
    const src = ['- a', '  - a1', '  - a2', '- b', '', '3. x', '4. y'].join('\n')
    const [ul, ol] = parseMarkdown(src)
    expect(ul).toMatchObject({ t: 'list', ordered: false })
    if (ul?.t !== 'list') throw new Error('expected list')
    expect(ul.items).toHaveLength(2)
    expect(ul.items[0]?.[0]).toEqual({ t: 'paragraph', c: [{ t: 'text', v: 'a' }] })
    expect(ul.items[0]?.[1]).toMatchObject({ t: 'list', items: [[{ t: 'paragraph', c: [{ t: 'text', v: 'a1' }] }], [{ t: 'paragraph', c: [{ t: 'text', v: 'a2' }] }]] })
    expect(ol).toMatchObject({ t: 'list', ordered: true, start: 3 })
  })
  it('parses pipe tables with alignment', () => {
    const src = ['| 名称 | 数量 |', '|:--|--:|', '| 苹果 | 3 |', '| 梨 | 12 |'].join('\n')
    const [table] = parseMarkdown(src)
    expect(table).toMatchObject({ t: 'table', align: ['left', 'right'] })
    if (table?.t !== 'table') throw new Error('expected table')
    expect(table.header.map(inlineText)).toEqual(['名称', '数量'])
    expect(table.rows.map((r) => r.map(inlineText))).toEqual([['苹果', '3'], ['梨', '12']])
  })
  it('hard line breaks with two trailing spaces', () => {
    const [p] = parseMarkdown('一行  \n二行')
    expect(p).toEqual({ t: 'paragraph', c: [{ t: 'text', v: '一行' }, { t: 'br' }, { t: 'text', v: '二行' }] })
  })
  it('an unterminated fence swallows to EOF without throwing', () => {
    expect(parseMarkdown('```\nabc')).toEqual([{ t: 'code', lang: undefined, v: 'abc' }])
  })
})
