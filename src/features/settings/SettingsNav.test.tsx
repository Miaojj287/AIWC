// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsNav } from './SettingsNav'
import { searchSettings } from './searchIndex'

vi.mock('@/platform/hooks', () => ({
  invoke: vi.fn(),
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

afterEach(cleanup)

function openSearch(query: string) {
  const onNavigate = vi.fn()
  render(<SettingsNav page="general" onNavigate={onNavigate} />)
  const input = screen.getByRole('searchbox', { name: '搜索设置' })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: query } })
  return { input, onNavigate }
}

describe('SettingsNav search results', () => {
  it('renders hits as kit ListItem rows (h42, title + location) inside the listbox', () => {
    openSearch('模型')
    const expected = searchSettings('模型')
    const listbox = screen.getByRole('listbox', { name: '匹配的设置项' })
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(expected.length)
    options.forEach((opt, i) => {
      const hit = expected[i]!
      expect(within(opt).getByText(hit.row.title)).toBeTruthy()
      expect(within(opt).getByText(hit.location)).toBeTruthy()
      expect(opt.className).toContain('min-h-[42px]')
      expect(opt.className).toContain('rounded-item')
      expect(opt.getAttribute('tabindex')).toBe('-1')
    })
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(options[0]?.hasAttribute('data-hover')).toBe(true)
    expect(options[1]?.getAttribute('aria-selected')).toBe('false')
  })

  it('moves the highlight with the arrow keys and picks with Enter or click', () => {
    const { input, onNavigate } = openSearch('模型')
    const expected = searchSettings('模型')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    let options = screen.getAllByRole('option')
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenLastCalledWith(expected[1]!.row.page, expected[1]!.row.id)
    // picking clears the query and closes the list
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '密钥' } })
    options = screen.getAllByRole('option')
    fireEvent.click(options[0]!)
    const [first] = searchSettings('密钥')
    expect(onNavigate).toHaveBeenLastCalledWith(first!.row.page, first!.row.id)
  })
})
