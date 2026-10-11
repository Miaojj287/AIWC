import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { clearToasts, getToasts } from '../toast/toastStore'
import { inlineText, type MarkdownInline } from './inline'
import { Markdown } from './Markdown'
import type { MarkdownRenderInlines } from './MarkdownTable'
import { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS } from './styles'

/*
 * jsdom resolves `:modal` / `:popover-open` by walking every ancestor, which floating-ui triggers for each positioned
 * menu; neither can match in jsdom, so answering false up front keeps the dropdown tests fast.
 */
const nativeMatches = Element.prototype.matches
Element.prototype.matches = function matches(this: Element, selectors: string): boolean {
  if (selectors === ':modal' || selectors === ':popover-open' || selectors === ':fullscreen') return false
  return nativeMatches.call(this, selectors)
}
afterAll(() => {
  Element.prototype.matches = nativeMatches
})

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  cleanup()
  clearToasts()
  Reflect.deleteProperty(navigator, 'clipboard')
  __resetLanguageForTests()
})

const SRC = ['# 一级', '## 二级', '### 三级', '', '行内 `code` 文本', '', '> 引用'].join('\n')
const TABLE = ['| 名称 | 数量 | 备注 |', '|:--|--:|:-:|', '| **苹果** | 3 | `红富士` |', '| 梨 | 12 |'].join('\n')

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

describe('<Markdown> typography stays on the token scale', () => {
  it('headings step 20 / 14 / 13 through token sizes, never an arbitrary px', () => {
    const { container } = render(<Markdown source={SRC} />)
    const h1 = container.querySelector('h1')
    const h2 = container.querySelector('h2')
    const h3 = container.querySelector('h3')
    expect(h1?.className).toContain('text-title')
    expect(h2?.className).toContain('text-bubble')
    expect(h3?.className).toContain('text-body')
    for (const el of [h1, h2, h3]) expect(el?.className).not.toMatch(/text-\[\d+px\]/)
  })

  it('inline code and blockquotes use named greys and r4, not ad-hoc fg tints', () => {
    const { container } = render(<Markdown source={SRC} />)
    const code = container.querySelector('code')
    expect(code?.textContent).toBe('code')
    expect(code?.className).toContain('text-caption')
    expect(code?.className).toContain('bg-line-8')
    expect(code?.className).toContain('rounded-sm')
    expect(code?.className).not.toMatch(/\brounded(?:-[a-z]+)?-\[[^\]]*px\]/)
    expect(code?.className).not.toMatch(/\bbg-fg\//)
    const quote = container.querySelector('blockquote')
    expect(quote?.className).toContain('border-(--line-25)')
    expect(quote?.className).not.toMatch(/border-fg\//)
  })

  it('composes every element from the shared classes (one look for replies and files)', () => {
    const { container } = render(<Markdown source={SRC} />)
    expect(container.firstElementChild?.className).toBe(MARKDOWN_CLASS.root)
    expect(container.querySelector('h1')?.className).toBe(`${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[1]}`)
    expect(container.querySelector('code')?.className).toBe(MARKDOWN_CLASS.inlineCode)
    for (const token of MARKDOWN_CLASS.quote.split(' '))
      expect(container.querySelector('blockquote')?.className).toContain(token)
  })

  it('uses the shared element classes (one radius, one quote bar)', () => {
    const el = mount(
      renderToStaticMarkup(<Markdown source={'# 标题\n\n`code`\n\n> 引用\n\n---\n\n```ts\nconst a = 1\n```'} />),
    )
    expect(tokens(el, 'code:not(pre code)')).toEqual(expect.arrayContaining(tokens(MARKDOWN_CLASS.inlineCode)))
    expect(tokens(el, 'code:not(pre code)')).not.toContain('rounded-[4px]')
    expect(tokens(el, 'blockquote')).toEqual(expect.arrayContaining(tokens(MARKDOWN_CLASS.quote)))
    expect(tokens(el, 'blockquote')).not.toContain('border-fg/16')
    expect(tokens(el, 'pre')).toEqual(expect.arrayContaining(tokens(MARKDOWN_CLASS.codeBlock)))
    expect(tokens(el, 'h1')).toEqual(
      expect.arrayContaining(tokens(`${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[1]}`)),
    )
    expect(tokens(el, 'hr')).toEqual(tokens(MARKDOWN_CLASS.hr))
  })
})

describe('<Markdown> tables', () => {
  it('renders a header row, aligned columns and inline formatting inside its own scroll box', () => {
    const { container } = render(<Markdown source={TABLE} />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual(['名称', '数量', '备注'])
    expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    expect(headers[0]?.className).toContain('font-semibold')
    expect(headers.map((th) => th.className.match(/\btext-(left|right|center)\b/)?.[1])).toEqual([
      'left',
      'right',
      'center',
    ])
    const cells = screen.getAllByRole('cell')
    expect(cells.map((td) => td.textContent)).toEqual(['苹果', '3', '红富士', '梨', '12', ''])
    expect(cells[0]?.querySelector('strong')?.className).toBe(MARKDOWN_CLASS.strong)
    expect(cells[2]?.querySelector('code')?.className).toBe(MARKDOWN_CLASS.inlineCode)
    // The table scrolls inside its frame; the wrapper never grows past its column.
    const frame = container.querySelector('table')?.parentElement
    expect(frame?.className).toContain('overflow-x-auto')
    expect(frame?.parentElement?.className).toContain('max-w-full')
    expect(frame?.parentElement?.className).toContain('min-w-0')
    expect(container.innerHTML).not.toMatch(/shadow|#[0-9a-f]{3,6}\b/i)
  })

  it('floors each column by its longest cell and lets cells break anywhere, so a URL cannot widen the table', () => {
    render(
      <Markdown
        source={[
          '| 号 | 状态 | 说明 | 链接 |',
          '|---|---|---|---|',
          '| 1 | 等待复核 | 等财务确认，确认后同步到群里 | https://example.com/a/very/long/path |',
        ].join('\n')}
      />,
    )
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((th) => th.className.match(/\bmin-w-\d+\b/)?.[0])).toEqual([
      'min-w-16',
      'min-w-20',
      'min-w-32',
      'min-w-32',
    ])
    expect(headers.every((th) => th.className.includes('whitespace-nowrap'))).toBe(true)
    expect(screen.getAllByRole('cell').every((td) => td.className.includes('wrap-anywhere'))).toBe(true)
  })

  it('shows a half-streamed table as a paragraph until its delimiter row is complete', () => {
    const { container, rerender } = render(<Markdown source={'| 名称 | 数量 |\n|--'} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('| 名称 | 数量 |\n|--')
    rerender(<Markdown source={'| 名称 | 数量 |\n|---|--'} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
  })

  it('offers no menu unless the surface asks for one', () => {
    render(<Markdown source={TABLE} />)
    expect(screen.queryByRole('button', { name: '表格操作' })).toBeNull()
  })

  it('copies the table as Markdown or TSV from the `···` menu and confirms with a toast', async () => {
    render(<Markdown source={TABLE} tableActions={{ copy: true }} />)
    // The last header cell keeps clear of the revealed button.
    expect(screen.getAllByRole('columnheader')[2]?.className).toContain('pr-8')
    fireEvent.keyDown(screen.getByRole('button', { name: '表格操作' }), { key: 'Enter' })
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('复制为 Markdown'),
      expect.stringContaining('复制为 TSV'),
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: /复制为 TSV/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('名称\t数量\t备注\n苹果\t3\t红富士\n梨\t12\t'))
    await waitFor(() => expect(getToasts().map((t) => [t.kind, t.text])).toEqual([['success', '表格已复制']]))

    fireEvent.keyDown(screen.getByRole('button', { name: '表格操作' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /复制为 Markdown/ }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('| :-- | --: | :-: |')))
  })

  it('hands 另存为 CSV the RFC 4180 text', async () => {
    const onSaveCsv = vi.fn()
    render(<Markdown source={TABLE} tableActions={{ onSaveCsv }} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '表格操作' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /另存为 CSV/ }))
    expect(onSaveCsv).toHaveBeenCalledWith('名称,数量,备注\r\n苹果,3,红富士\r\n梨,12,\r\n')
  })

  it('reports a copy that could not reach the clipboard', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    render(<Markdown source={TABLE} tableActions={{ copy: true }} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '表格操作' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /复制为 Markdown/ }))
    await waitFor(() => expect(getToasts().map((t) => [t.kind, t.text])).toEqual([['error', '复制失败']]))
  })
})

describe('<Markdown> surface options', () => {
  it('renderInlines replaces every inline run, and a table cell reads with the whole table as its scope', () => {
    const scopes = new Map<string, readonly MarkdownInline[]>()
    const renderInlines: MarkdownRenderInlines = (nodes, scope) => {
      scopes.set(inlineText(nodes), scope)
      return <mark>{inlineText(nodes)}</mark>
    }
    const { container } = render(
      <Markdown
        source={'# 题\n\n段落\n\n- 项\n\n> 引用\n\n| a | b |\n|---|---|\n| 1 | 2 |'}
        renderInlines={renderInlines}
      />,
    )
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      '题',
      '段落',
      '项',
      '引用',
      'a',
      'b',
      '1',
      '2',
    ])
    expect(inlineText(scopes.get('段落') ?? [])).toBe('段落')
    const cellScopes = new Set(['a', 'b', '1', '2'].map((cell) => scopes.get(cell)))
    expect(cellScopes.size).toBe(1)
    expect(inlineText([...cellScopes][0] ?? [])).toBe('a | b\n1 | 2')
  })

  it('opens links through onLink, and otherwise leaves them inert with the target in the title', () => {
    const onLink = vi.fn()
    const { unmount } = render(<Markdown source="见 [文档](https://example.com/doc)" onLink={onLink} />)
    fireEvent.click(screen.getByRole('link', { name: '文档' }))
    expect(onLink).toHaveBeenCalledWith('https://example.com/doc')
    unmount()
    render(<Markdown source="见 [文档](https://example.com/doc)" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('文档').getAttribute('title')).toBe('https://example.com/doc')
  })

  it('keeps single newlines visible only when asked (chat replies)', () => {
    const { container, rerender } = render(<Markdown source={'一行\n二行\n\n- 甲\n  乙'} />)
    expect(container.querySelector('p')?.className).not.toContain('whitespace-pre-wrap')
    rerender(<Markdown source={'一行\n二行\n\n- 甲\n  乙'} preserveLineBreaks />)
    expect(container.querySelector('p')?.className).toContain('whitespace-pre-wrap')
    expect(container.querySelector('li')?.className).toContain('whitespace-pre-wrap')
    expect(container.querySelector('li')?.textContent).toBe('甲\n乙')
  })

  it('never turns source text into HTML', () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)"> **<script>x</script>**'} />)
    expect(container.querySelector('img, script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })
})

describe('<Markdown> code blocks', () => {
  it('copies the code from a hover-revealed button that flashes ✓', async () => {
    render(<Markdown source={'```ts\nconst a = 1\n```'} />)
    const button = screen.getByRole('button', { name: '复制代码' })
    expect(button.className).toContain('opacity-0')
    expect(button.className).toContain('group-hover/code:opacity-100')
    fireEvent.click(button)
    await screen.findByRole('button', { name: '已复制' })
    expect(writeText).toHaveBeenCalledWith('const a = 1')
  })

  it('says so when the clipboard is unavailable instead of pretending it copied', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    render(<Markdown source={'```\nx\n```'} />)
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(getToasts().map((t) => t.text)).toEqual(['复制失败']))
    expect(screen.queryByRole('button', { name: '已复制' })).toBeNull()
  })

  it('labels its controls in English too', () => {
    setLanguage('en-US')
    render(<Markdown source={`${TABLE}\n\n\`\`\`\nx\n\`\`\``} tableActions={{ copy: true }} />)
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Table actions' })).toBeTruthy()
  })
})
