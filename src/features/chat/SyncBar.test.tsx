// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from './filters'
import { SyncBar } from './SyncBar'
import type { SyncView } from './syncModel'

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

const SYNCED: SyncView = { phase: 'synced', text: '已同步 · 刚刚', detail: '上次同步 14:32' }

describe('<SyncBar>', () => {
  it('sits on the panel surface token, not an ad-hoc fg tint', () => {
    const { container } = render(<SyncBar view={SYNCED} filters={DEFAULT_FILTERS} onFiltersChange={vi.fn()} senders={[]} onSync={vi.fn()} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('bg-panel')
    expect(root.className).toContain('h-[34px]')
    expect(root.className).not.toContain('bg-fg/')
    expect(root.className).toContain('border-line-6')
  })

  it('uses the hover token on the status control and triggers a sync on click', () => {
    const onSync = vi.fn()
    render(<SyncBar view={SYNCED} filters={DEFAULT_FILTERS} onFiltersChange={vi.fn()} senders={[]} onSync={onSync} />)
    const status = screen.getByText('已同步 · 刚刚').closest('button') as HTMLButtonElement
    expect(status.className).toContain('hover:bg-hover-5')
    expect(status.className).not.toContain('bg-fg/')
    fireEvent.click(status)
    expect(onSync).toHaveBeenCalledTimes(1)
  })
})
