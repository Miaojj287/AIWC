import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Tab } from './Tab'

afterEach(cleanup)

it('moves and activates tabs with arrows, wraps, and supports Home and End', () => {
  const select = vi.fn()
  render(
    <div role="tablist">
      <Tab label="First" active onSelect={() => select('first')} />
      <Tab label="Second" onSelect={() => select('second')} />
      <Tab label="Last" onSelect={() => select('last')} />
    </div>,
  )
  const first = screen.getByRole('tab', { name: 'First' })
  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Second' }))
  expect(select).toHaveBeenLastCalledWith('second')
  fireEvent.keyDown(document.activeElement!, { key: 'End' })
  expect(select).toHaveBeenLastCalledWith('last')
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
  expect(select).toHaveBeenLastCalledWith('first')
  fireEvent.keyDown(first, { key: 'ArrowLeft' })
  expect(select).toHaveBeenLastCalledWith('last')
  fireEvent.keyDown(document.activeElement!, { key: 'Home' })
  expect(select).toHaveBeenLastCalledWith('first')
})
