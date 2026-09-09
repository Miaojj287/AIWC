// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS } from '@/features/agent/markdownStyles'
import { Markdown } from './Markdown'

vi.mock('@/platform/hooks', () => ({
  invoke: vi.fn(async () => undefined),
}))

afterEach(cleanup)

const SRC = ['# 一级', '## 二级', '### 三级', '', '行内 `code` 文本', '', '> 引用'].join('\n')

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

  it('composes every element from the shared markdownStyles classes (one look with Agent replies)', () => {
    const { container } = render(<Markdown source={SRC} />)
    expect(container.firstElementChild?.className).toBe(MARKDOWN_CLASS.root)
    expect(container.querySelector('h1')?.className).toBe(`${MARKDOWN_CLASS.heading} ${MARKDOWN_HEADING_CLASS[1]}`)
    expect(container.querySelector('code')?.className).toBe(MARKDOWN_CLASS.inlineCode)
    for (const token of MARKDOWN_CLASS.quote.split(' ')) expect(container.querySelector('blockquote')?.className).toContain(token)
  })
})
