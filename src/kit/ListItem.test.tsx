// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ListItem } from './ListItem'

afterEach(cleanup)

const more = () => screen.getByRole('button', { name: '更多操作' })

describe('ListItem hover actions', () => {
  it('keeps the `···` out of the trailing control instead of stacking on top of it', () => {
    render(
      <ListItem
        data-hover
        title="地狱打工人"
        subtitle="已暂停"
        trailing={<button type="button">自动回复</button>}
        hoverActions={<button type="button" aria-label="更多操作" />}
        onSelect={() => {}}
      />,
    )
    const slot = more().parentElement as HTMLElement
    // Absolute positioning is what used to put the `···` on top of the Toggle / unread Badge.
    expect(slot.className).not.toContain('absolute')
    // The slot reserves its width so revealing it cannot shove the trailing control sideways.
    expect(slot.className).toContain('invisible')
    expect(slot.className).toContain('group-hover:visible')
    expect(slot.nextElementSibling?.textContent).toBe('自动回复')
  })

  it('still overlays the corner (and hides `meta`) when the row has no trailing control', () => {
    render(<ListItem data-hover title="林文轩" meta="03:08" hoverActions={<button type="button" aria-label="更多操作" />} onSelect={() => {}} />)
    const slot = more().parentElement as HTMLElement
    expect(slot.className).toContain('absolute')
    expect(screen.getByText('03:08').className).toContain('group-hover:hidden')
  })

  it('does not hide `meta` on hover when nothing overlays it', () => {
    render(<ListItem title="林文轩" meta="03:08" trailing={<span>2</span>} hoverActions={<button type="button" aria-label="更多操作" />} onSelect={() => {}} />)
    expect(screen.getByText('03:08').className).not.toContain('group-hover:hidden')
  })
})
