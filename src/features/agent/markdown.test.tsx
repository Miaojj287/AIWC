// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown as FileMarkdown } from '@/features/file/markdown'
import { inlineToText, parseInline, parseMarkdown } from './markdownParser'
import { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS } from './markdownStyles'
import { Markdown } from './MarkdownView'

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists, quotes, rules and fenced code', () => {
    const src = ['# 标题', '', '第一段 **重点** 和 `code`。', '继续同一段。', '', '- 甲', '- 乙 *斜体*', '', '1. one', '2. two', '', '> 引用', '', '---', '', '```json', '{ "a": 1 }', '```', '尾段'].join('\n')
    const blocks = parseMarkdown(src)
    expect(blocks).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: '标题' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '第一段 ' },
          { type: 'bold', children: [{ type: 'text', text: '重点' }] },
          { type: 'text', text: ' 和 ' },
          { type: 'code', text: 'code' },
          { type: 'text', text: '。\n继续同一段。' },
        ],
      },
      { type: 'list', ordered: false, start: 1, items: [[{ type: 'text', text: '甲' }], [{ type: 'text', text: '乙 ' }, { type: 'italic', children: [{ type: 'text', text: '斜体' }] }]] },
      { type: 'list', ordered: true, start: 1, items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]] },
      { type: 'quote', children: [{ type: 'text', text: '引用' }] },
      { type: 'rule' },
      { type: 'code', lang: 'json', code: '{ "a": 1 }' },
      { type: 'paragraph', children: [{ type: 'text', text: '尾段' }] },
    ])
  })

  it('keeps an unterminated fence as code while streaming', () => {
    expect(parseMarkdown('```ts\nconst a = 1')).toEqual([{ type: 'code', lang: 'ts', code: 'const a = 1' }])
  })

  it('does not treat mid-sentence asterisks or e-mail style text as markup', () => {
    expect(parseInline('a * b * c')).toEqual([{ type: 'text', text: 'a * b * c' }])
    expect(parseInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }])
    expect(parseInline('**未闭合')).toEqual([{ type: 'text', text: '**未闭合' }])
    expect(parseInline('转义 \\*不是斜体\\*')).toEqual([{ type: 'text', text: '转义 *不是斜体*' }])
  })

  it('parses links and nested emphasis inside bold', () => {
    expect(parseInline('看 [文档](https://example.com) 和 **加粗 *斜* 字**')).toEqual([
      { type: 'text', text: '看 ' },
      { type: 'link', text: '文档', href: 'https://example.com' },
      { type: 'text', text: ' 和 ' },
      { type: 'bold', children: [{ type: 'text', text: '加粗 ' }, { type: 'italic', children: [{ type: 'text', text: '斜' }] }, { type: 'text', text: ' 字' }] },
    ])
    expect(inlineToText(parseInline('**a** `b` [c](d)'))).toBe('a b c')
  })

  it('a code span keeps asterisks literal', () => {
    expect(parseInline('`a * b` and **x**')).toEqual([{ type: 'code', text: 'a * b' }, { type: 'text', text: ' and ' }, { type: 'bold', children: [{ type: 'text', text: 'x' }] }])
  })
})

describe('<Markdown>', () => {
  it('renders headings, bold and code with the mono face (snapshot)', () => {
    const html = renderToStaticMarkup(<Markdown text={'## 结论\n\n共 **6** 个议题，见 `周报草稿.md`。\n\n```json\n{"total":6}\n```'} />)
    expect(html).toContain('<h2')
    expect(html).toContain('<strong')
    expect(html).toContain('font-mono')
    expect(html).toContain('复制代码')
    expect(html).toMatchSnapshot()
  })

  it('uses the shared element classes (one radius, one quote bar)', () => {
    const el = mount(renderToStaticMarkup(<Markdown text={'# 标题\n\n`code`\n\n> 引用\n\n---\n\n```ts\nconst a = 1\n```'} />))
    expect(tokens(el, 'code:not(pre code)')).toEqual(expect.arrayContaining(tokens(MARKDOWN_CLASS.inlineCode)))
    expect(tokens(el, 'code:not(pre code)')).not.toContain('rounded-[4px]')
    expect(tokens(el, 'blockquote')).toEqual(expect.arrayContaining(tokens(MARKDOWN_CLASS.quote)))
    expect(tokens(el, 'blockquote')).not.toContain('border-fg/16')
    expect(tokens(el, 'pre')).toEqual(expect.arrayContaining(tokens(MARKDOWN_CLASS.codeBlock)))
    expect(tokens(el, 'h1')).toEqual(expect.arrayContaining(tokens(`${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[1]}`)))
    expect(tokens(el, 'hr')).toEqual(tokens(MARKDOWN_CLASS.hr))
  })
})

/**
 * Agent replies and generated .md files are the same thing on two surfaces (CLAUDE.md §3): every
 * element the reviewer can see must carry the same look in both renderers. Layout-only extras
 * (min-w-0, whitespace, flex for nested blocks) are allowed, so this checks the shared tokens are a
 * subset of each side rather than exact equality.
 */
describe('Markdown look parity (agent panel vs file tab)', () => {
  const src = ['# 一级', '## 二级', '### 三级', '', '段落 **重点** `code` [链接](https://example.com)', '', '> 引用', '', '- 甲', '- 乙', '', '---', '', '```ts', 'const a = 1', '```'].join('\n')
  const agent = mount(renderToStaticMarkup(<Markdown text={src} />))
  const file = mount(renderToStaticMarkup(<FileMarkdown source={src} onLink={() => undefined} />))

  it.each([
    ['h1', `${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[1]}`],
    ['h2', `${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[2]}`],
    ['h3', `${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[3]}`],
    ['strong', MARKDOWN_CLASS.strong],
    ['code:not(pre code)', MARKDOWN_CLASS.inlineCode],
    ['blockquote', MARKDOWN_CLASS.quote],
    ['ul', MARKDOWN_CLASS.list],
    ['pre', MARKDOWN_CLASS.codeBlock],
    ['hr', MARKDOWN_CLASS.hr],
  ])('%s carries the shared classes on both surfaces', (selector, shared) => {
    const expected = expect.arrayContaining(tokens(shared))
    expect(tokens(agent, selector)).toEqual(expected)
    expect(tokens(file, selector)).toEqual(expected)
  })

  it('links share the accent underline (agent: span with title, file: anchor)', () => {
    const expected = expect.arrayContaining(tokens(MARKDOWN_CLASS.link))
    expect(tokens(agent, 'span[title]')).toEqual(expected)
    expect(tokens(file, 'a')).toEqual(expected)
  })
})

function mount(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

/** Sorted class tokens of `selector` inside `root`, or of a raw class string. */
function tokens(root: HTMLElement | string, selector?: string): string[] {
  if (typeof root === 'string') return root.split(/\s+/).filter(Boolean).sort()
  const node = root.querySelector(selector ?? '*')
  if (!node) throw new Error(`no element for ${selector}`)
  return tokens(node.getAttribute('class') ?? '')
}
