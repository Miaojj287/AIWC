// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { InlineHint } from './InlineHint'

afterEach(cleanup)

describe('InlineHint', () => {
  it('wraps by default', () => {
    render(<InlineHint kind="info">更新包由应用自动下载</InlineHint>)
    const text = screen.getByText('更新包由应用自动下载')
    expect(text.className).toContain('break-words')
    expect(text.className).not.toContain('truncate')
  })

  it('truncates on the text span (never the flex root) and keeps the full text in title', () => {
    render(
      <InlineHint kind="success" truncate>
        已连接 · 420 ms
      </InlineHint>,
    )
    const text = screen.getByText('已连接 · 420 ms')
    const root = text.parentElement as HTMLElement
    expect(text.className).toContain('truncate')
    expect(root.className).toContain('flex')
    expect(root.className).not.toContain('truncate')
    expect(root.className).toContain('min-w-0')
    expect(root.getAttribute('title')).toBe('已连接 · 420 ms')
  })
})
