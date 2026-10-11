// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/kit'
import { BottomBar, SelectionBar } from './ChatBars'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub))
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('chat bars: per-message delete has no backend yet', () => {
  it('keeps 删除 visible but disabled, and says why, in the bottom bar', () => {
    render(
      <TooltipProvider>
        <BottomBar
          allState={false}
          onToggleAll={vi.fn()}
          onExport={vi.fn()}
          onQuote={vi.fn()}
          disabled={false}
          selectedCount={0}
        />
      </TooltipProvider>,
    )
    const del = screen.getByRole('button', { name: '删除' })
    expect((del as HTMLButtonElement).disabled).toBe(true)
    expect(del.getAttribute('aria-description')).toContain('暂不支持删除单条本地记录')
  })

  it('offers 复制 for the selection and keeps 删除 disabled in the selection bar', () => {
    const onCopy = vi.fn()
    render(
      <TooltipProvider>
        <SelectionBar count={2} onQuote={vi.fn()} onCopy={onCopy} onExport={vi.fn()} onCancel={vi.fn()} />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '删除' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
