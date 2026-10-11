// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/kit'
import { ThreadExportDialog } from './ThreadExportDialog'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = (onExport = vi.fn()) => {
  render(
    <TooltipProvider>
      <ThreadExportDialog open onOpenChange={() => {}} onExport={onExport} />
    </TooltipProvider>,
  )
  return onExport
}

describe('<ThreadExportDialog>', () => {
  it('exports the privacy-safe choice unless the user opts in', async () => {
    const onExport = mount()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await waitFor(() =>
      expect(onExport).toHaveBeenLastCalledWith({
        format: 'md',
        includeToolOutputs: false,
        includeReasoning: false,
        redactIdentifiers: true,
      }),
    )
  })

  it('sends what was switched on, in the chosen format', async () => {
    const onExport = mount()
    fireEvent.click(screen.getByRole('switch', { name: '包含工具的输入与结果' }))
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await waitFor(() =>
      expect(onExport).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'json', includeToolOutputs: true })),
    )
  })
})
