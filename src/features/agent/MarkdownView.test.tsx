// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WxMessage, WxSession } from '@aiwc/protocol'
import {
  clearToasts,
  getToasts,
  Markdown as KitMarkdown,
  MARKDOWN_CLASS,
  MARKDOWN_HEADING_CLASS,
  TooltipProvider,
} from '@/kit'
import { __resetCitationCacheForTests } from './citationResolver'
import { Markdown } from './MarkdownView'
import { patchJsdomTopLayerMatches } from './testUtils'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

const message: WxMessage = {
  id: 'wx:26442:1739500000000',
  sessionId: 'wxid_xw',
  seq: 1739500000000,
  createdAt: new Date(2026, 1, 14, 19, 28).getTime(),
  senderId: 'wxid_xw',
  senderName: '小吴',
  isSelf: false,
  kind: 'text',
  text: '你自己都说没有 yanda 你会和小吴纠缠一阵子',
  anchor: { sessionId: 'wxid_xw', messageId: 'wx:26442:1739500000000', seq: 1739500000000, createdAt: 0 },
}
const session = { id: 'wxid_xw', title: '小吴', kind: 'dm' } as unknown as WxSession
const href = 'wx://wxid_xw/wx:26442:1739500000000'

beforeEach(() => {
  __resetCitationCacheForTests()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel) =>
    channel === 'substrate:getMessage' ? message : channel === 'substrate:getSession' ? session : undefined,
  )
})
afterEach(() => {
  cleanup()
  clearToasts()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

const renderReply = (text: string) =>
  render(
    <TooltipProvider>
      <Markdown text={text} />
    </TooltipProvider>,
  )

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

describe('<Markdown> in Agent replies', () => {
  it('renders headings, bold and code with the mono face (snapshot)', () => {
    const html = renderToStaticMarkup(
      <Markdown text={'## 结论\n\n共 **6** 个议题，见 `周报草稿.md`。\n\n```json\n{"total":6}\n```'} />,
    )
    expect(html).toContain('<h2')
    expect(html).toContain('<strong')
    expect(html).toContain('font-mono')
    expect(html).toContain('复制代码')
    expect(html).toMatchSnapshot()
  })

  it('keeps soft line breaks of a reply visible', () => {
    const { container } = renderReply('第一行\n第二行')
    expect(container.querySelector('p')?.className).toContain('whitespace-pre-wrap')
    expect(container.querySelector('p')?.textContent).toBe('第一行\n第二行')
  })
})

/**
 * Agent replies and generated .md files are the same thing on two surfaces (CLAUDE.md §3): every element the
 * reviewer can see must carry the same look in both. Layout-only extras (whitespace) are allowed, so this checks the
 * shared tokens are a subset of each side rather than exact equality.
 */
describe('Markdown look parity (agent panel vs file tab)', () => {
  const src = [
    '# 一级',
    '## 二级',
    '### 三级',
    '',
    '段落 **重点** `code` [链接](https://example.com)',
    '',
    '> 引用',
    '',
    '- 甲',
    '- 乙',
    '',
    '---',
    '',
    '```ts',
    'const a = 1',
    '```',
    '',
    '| 列 | 值 |',
    '|---|--:|',
    '| a | 1 |',
  ].join('\n')
  const agent = mount(renderToStaticMarkup(<Markdown text={src} />))
  const file = mount(renderToStaticMarkup(<KitMarkdown source={src} onLink={() => undefined} />))

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
    ['table', MARKDOWN_CLASS.table],
    ['th', MARKDOWN_CLASS.tableHeader],
    ['td', MARKDOWN_CLASS.tableCell],
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

describe('tables in Agent replies', () => {
  const quoted = (quote: string) => `| 原话 | 出处 |\n|---|---|\n| “${quote}” | [02-14 19:28](${href}) |`

  it('turns a wx:// link in a cell into a chip that checks the quote in the cell before it', async () => {
    renderReply(quoted('没有 yanda 你会和小吴纠缠一阵子'))
    await flush()
    const chip = screen.getByRole('button', { name: /小吴 · 02-14 19:28/ })
    expect(chip.closest('td')).not.toBeNull()
    expect(chip.getAttribute('data-verdict')).toBe('verbatim')
  })

  it('flags a quote in the neighbouring cell that the cited message does not contain', async () => {
    renderReply(quoted('你和小吴已经在一起了'))
    await flush()
    expect(screen.getByRole('button', { name: /小吴/ }).getAttribute('data-verdict')).toBe('mismatch')
  })

  it('saves the table as CSV through file:saveExport and offers 打开位置', async () => {
    invokeMock.mockImplementation(async (channel) =>
      channel === 'file:saveExport' ? { path: '/data/exports/表格-1.csv' } : undefined,
    )
    renderReply('| 名称 | 数量 |\n|---|--:|\n| 苹果, 红 | 3 |')
    fireEvent.keyDown(screen.getByRole('button', { name: '表格操作' }), { key: 'Enter' })
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('复制为 Markdown'),
      expect.stringContaining('复制为 TSV'),
      expect.stringContaining('另存为 CSV'),
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: /另存为 CSV/ }))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('file:saveExport', {
        name: '表格',
        ext: 'csv',
        content: '名称,数量\r\n"苹果, 红",3\r\n',
      }),
    )
    await waitFor(() => expect(getToasts()).toHaveLength(1))
    const [saved] = getToasts()
    expect(saved).toMatchObject({ kind: 'success', text: 'CSV 已保存', detail: '/data/exports/表格-1.csv' })
    expect(saved?.action?.label).toBe('打开位置')
    saved?.action?.onClick()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('file:reveal', { path: '/data/exports/表格-1.csv' }))
  })

  it('says why a CSV could not be saved', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'file:saveExport') throw new Error('文件过大（超过 5 MB）')
      return undefined
    })
    renderReply('| a |\n|---|\n| 1 |')
    fireEvent.keyDown(screen.getByRole('button', { name: '表格操作' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /另存为 CSV/ }))
    await waitFor(() =>
      expect(getToasts().map((t) => [t.kind, t.text])).toEqual([['error', '保存 CSV 失败：文件过大（超过 5 MB）']]),
    )
  })
})
