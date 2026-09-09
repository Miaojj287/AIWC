// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SenderFilter, type SenderOption } from './SenderFilter'

// Radix Popper measures with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Floating UI probes ancestors with `:popover-open` / `:modal`; jsdom's selector engine has neither.
const nativeMatches = Element.prototype.matches
const TOP_LAYER = new Set([':popover-open', ':modal'])
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.matches = function (this: Element, selector: string) {
    return TOP_LAYER.has(selector) ? false : nativeMatches.call(this, selector)
  }
})
afterEach(() => {
  Element.prototype.matches = nativeMatches
  vi.unstubAllGlobals()
  cleanup()
})

const OPTIONS: SenderOption[] = [
  { id: 'wxid_a', name: '张三', detail: '产品' },
  { id: 'wxid_b', name: '李四' },
]

function openMenu() {
  const trigger = screen.getByRole('button', { name: '发送者筛选' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  return screen.getByRole('menu')
}

describe('<SenderFilter>', () => {
  it('shows 清空 as a kit link Button when a subset is selected and clears on click', () => {
    const onChange = vi.fn()
    render(<SenderFilter options={OPTIONS} value={['wxid_a']} onChange={onChange} />)
    openMenu()
    const clear = screen.getByRole('button', { name: '清空' })
    // link variant frame from the kit, not a hand-rolled <button>
    expect(clear.className).toContain('text-accent')
    expect(clear.className).toContain('rounded-control')
    expect(clear.className).toContain('text-micro')
    expect(clear.getAttribute('type')).toBe('button')
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('hides 清空 when everyone is selected', () => {
    render(<SenderFilter options={OPTIONS} value={[]} onChange={vi.fn()} />)
    openMenu()
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
    expect(screen.getByText('所有人 · 2')).toBeTruthy()
  })
})
