import { describe, expect, it } from 'vitest'
import { inlineText, parseInline, type MarkdownInline } from './inline'

const text = (value: string): MarkdownInline => ({ type: 'text', text: value })

describe('parseInline — Agent reply rules', () => {
  it('does not treat mid-sentence asterisks or e-mail style text as markup', () => {
    expect(parseInline('a * b * c')).toEqual([text('a * b * c')])
    expect(parseInline('snake_case_name')).toEqual([text('snake_case_name')])
    expect(parseInline('**未闭合')).toEqual([text('**未闭合')])
    expect(parseInline('转义 \\*不是斜体\\*')).toEqual([text('转义 *不是斜体*')])
  })

  it('parses links and nested emphasis inside bold', () => {
    expect(parseInline('看 [文档](https://example.com) 和 **加粗 *斜* 字**')).toEqual([
      text('看 '),
      { type: 'link', href: 'https://example.com', children: [text('文档')] },
      text(' 和 '),
      { type: 'strong', children: [text('加粗 '), { type: 'em', children: [text('斜')] }, text(' 字')] },
    ])
    expect(inlineText(parseInline('**a** `b` [c](d)'))).toBe('a b c')
  })

  it('a code span keeps asterisks literal', () => {
    expect(parseInline('`a * b` and **x**')).toEqual([
      { type: 'code', text: 'a * b' },
      text(' and '),
      { type: 'strong', children: [text('x')] },
    ])
  })

  it('nests strong inside em and splits a triple run into strong around em', () => {
    expect(parseInline('*a **b** c*')).toEqual([
      { type: 'em', children: [text('a '), { type: 'strong', children: [text('b')] }, text(' c')] },
    ])
    expect(parseInline('***都要***')).toEqual([
      { type: 'strong', children: [{ type: 'em', children: [text('都要')] }] },
    ])
  })

  it('closes emphasis across an unmatched backtick and a soft break', () => {
    expect(parseInline('**a `b**')).toEqual([{ type: 'strong', children: [text('a `b')] }])
    expect(parseInline('**第一行\n第二行**')).toEqual([{ type: 'strong', children: [text('第一行\n第二行')] }])
  })

  it('matches code spans by run length', () => {
    expect(parseInline('``a ` b``')).toEqual([{ type: 'code', text: 'a ` b' }])
    expect(parseInline('`` `x` ``')).toEqual([{ type: 'code', text: '`x`' }])
    expect(parseInline('```没闭合')).toEqual([text('```没闭合')])
  })
})

describe('parseInline — file preview rules', () => {
  it('handles strong / em / code / links / autolinks / escapes', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.y) https://z.w. \\*f\\*')).toEqual([
      text('a '),
      { type: 'strong', children: [text('b')] },
      text(' '),
      { type: 'em', children: [text('c')] },
      text(' '),
      { type: 'code', text: 'd' },
      text(' '),
      { type: 'link', href: 'https://x.y', children: [text('e')] },
      text(' '),
      { type: 'link', href: 'https://z.w', children: [text('https://z.w')] },
      text('. *f*'),
    ])
  })

  it('marks images as links labelled with their alt text and leaves stray markers alone', () => {
    expect(parseInline('![图](a.png) 2 * 3 = 6_x')).toEqual([
      { type: 'link', href: 'a.png', children: [text('图')], image: true },
      text(' 2 * 3 = 6_x'),
    ])
    expect(inlineText(parseInline('**a** `b`'))).toBe('a b')
  })

  it('accepts __strong__, a link title and an empty label', () => {
    expect(parseInline('__重点__')).toEqual([{ type: 'strong', children: [text('重点')] }])
    expect(parseInline('[文档](https://x.y "标题")')).toEqual([
      { type: 'link', href: 'https://x.y', children: [text('文档')] },
    ])
    expect(parseInline('[](https://x.y)')).toEqual([
      { type: 'link', href: 'https://x.y', children: [text('https://x.y')] },
    ])
  })
})

describe('parseInline — line breaks, escapes and URLs', () => {
  it('keeps soft breaks as "\\n" and turns two trailing spaces or a backslash into a hard break', () => {
    expect(parseInline('一行\n   二行')).toEqual([text('一行\n二行')])
    expect(parseInline('一行  \n二行')).toEqual([text('一行'), { type: 'break' }, text('二行')])
    expect(parseInline('一行\\\n二行')).toEqual([text('一行'), { type: 'break' }, text('二行')])
    expect(inlineText(parseInline('a  \nb'))).toBe('a\nb')
  })

  it('escapes only ASCII punctuation, so a Windows path keeps its backslashes', () => {
    expect(parseInline('C:\\Users\\me\\报告.md')).toEqual([text('C:\\Users\\me\\报告.md')])
    expect(parseInline('\\[不是链接\\](x)')).toEqual([text('[不是链接](x)')])
  })

  it('stops a bare URL at Chinese text and full-width punctuation', () => {
    expect(parseInline('详见https://example.com/a_b?x=1，然后')).toEqual([
      text('详见'),
      { type: 'link', href: 'https://example.com/a_b?x=1', children: [text('https://example.com/a_b?x=1')] },
      text('，然后'),
    ])
    expect(parseInline('(see https://x.y)')).toEqual([
      text('(see '),
      { type: 'link', href: 'https://x.y', children: [text('https://x.y')] },
      text(')'),
    ])
    expect(parseInline('xhttps://x.y')).toEqual([text('xhttps://x.y')])
  })

  it('turns <https://…> into a link without the brackets and never nests a link in a label', () => {
    expect(parseInline('<https://x.y/a>')).toEqual([
      { type: 'link', href: 'https://x.y/a', children: [text('https://x.y/a')] },
    ])
    expect(parseInline('[https://x.y](https://x.y)')).toEqual([
      { type: 'link', href: 'https://x.y', children: [text('https://x.y')] },
    ])
  })

  it('keeps a half-streamed link or citation as text', () => {
    expect(parseInline('见 [02-14 19:28](wx://wxid_a/m')).toEqual([text('见 [02-14 19:28](wx://wxid_a/m')])
    expect(parseInline('见 [02-14 19:28](wx://wxid_a/m1)')).toEqual([
      text('见 '),
      { type: 'link', href: 'wx://wxid_a/m1', children: [text('02-14 19:28')] },
    ])
  })

  it('treats markup in source as text: nothing here produces HTML', () => {
    expect(parseInline('<script>alert(1)</script> <b>粗</b>')).toEqual([text('<script>alert(1)</script> <b>粗</b>')])
  })
})
