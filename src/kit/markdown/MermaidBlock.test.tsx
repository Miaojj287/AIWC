import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

const renderMermaid = vi.fn<(code: string) => Promise<string>>()
vi.mock('./mermaidLoader', () => ({ renderMermaid: (code: string) => renderMermaid(code) }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  renderMermaid.mockReset()
})

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>图</text></svg>'
const source = '```mermaid\ngraph TD; A-->B\n```'

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

describe('```mermaid blocks', () => {
  it('draws the diagram, and switches to its source and back', async () => {
    vi.useFakeTimers()
    renderMermaid.mockResolvedValue(SVG)
    const { container } = render(<Markdown source={source} />)
    expect(screen.getByText('正在绘制图表')).toBeTruthy()
    await settle()
    expect(renderMermaid).toHaveBeenCalledWith('graph TD; A-->B')
    expect(container.querySelector('svg text')?.textContent).toBe('图')
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }))
    expect(screen.getByText('graph TD; A-->B')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看图表' }))
    expect(container.querySelector('svg text')).toBeTruthy()
  })

  it('falls back to the source when the diagram cannot be drawn', async () => {
    vi.useFakeTimers()
    renderMermaid.mockRejectedValue(new Error('parse error'))
    render(<Markdown source={source} />)
    await settle()
    expect(screen.getByText('图表无法绘制，已显示源码')).toBeTruthy()
    expect(screen.getByText('graph TD; A-->B')).toBeTruthy()
  })
})

describe('images', () => {
  it('stay links unless the surface resolves them, then open zoomable', () => {
    const { rerender } = render(<Markdown source="![图表](/tmp/chart.png)" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('图表')).toBeTruthy()
    rerender(<Markdown source="![图表](/tmp/chart.png)" resolveImage={(src) => `aiwc-media://${src}`} />)
    const img = screen.getByRole('img', { name: '图表' })
    expect(img.getAttribute('src')).toBe('aiwc-media:///tmp/chart.png')
    fireEvent.click(screen.getByRole('button', { name: '放大查看图片' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
