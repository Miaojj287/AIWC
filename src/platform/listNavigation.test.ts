import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { listKeyNav } from './listNavigation'

function List() {
  return createElement(
    'div',
    { 'data-testid': 'list', onKeyDown: listKeyNav },
    createElement('input', { 'aria-label': 'search' }),
    ['a', 'b', 'c'].map((id) =>
      createElement(
        'div',
        { key: id, className: 'kit-row', tabIndex: 0, role: 'button', 'data-testid': `row-${id}` },
        id,
      ),
    ),
    createElement('div', { className: 'kit-row', tabIndex: 0, 'aria-disabled': 'true' }, 'off'),
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('listKeyNav', () => {
  it('moves focus with the arrow keys and jumps with Home / End, skipping disabled rows', () => {
    render(createElement(List))
    const [a, b, c] = ['a', 'b', 'c'].map((id) => screen.getByTestId(`row-${id}`))
    // Keys arrive on the focused row and bubble to the container's handler, as they do in the app.
    const press = (key: string) => fireEvent.keyDown(document.activeElement as Element, { key })
    a!.focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(b)
    press('End')
    expect(document.activeElement).toBe(c)
    press('ArrowDown')
    expect(document.activeElement).toBe(c)
    press('Home')
    expect(document.activeElement).toBe(a)
    press('ArrowUp')
    expect(document.activeElement).toBe(a)
  })

  it('leaves the arrow keys alone inside text fields', () => {
    render(createElement(List))
    const search = screen.getByLabelText('search')
    search.focus()
    const notPrevented = fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(search)
    expect(notPrevented).toBe(true)
  })
})
