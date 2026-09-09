// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toggle } from './Toggle'

afterEach(cleanup)

describe('Toggle', () => {
  it('renders a switch whose track and thumb use only token colours, with no shadow', () => {
    render(<Toggle label="自动回复" />)
    const track = screen.getByRole('switch', { name: '自动回复' })
    expect(track.className).toContain('bg-(--fill-20)')
    expect(track.className).toContain('hover:bg-(--fill-28)')
    expect(track.className).toContain('data-[state=checked]:bg-accent')

    const thumb = track.firstElementChild as HTMLElement
    expect(thumb).not.toBeNull()
    expect(thumb.className).toContain('bg-(--fg-on-accent)')
    expect(thumb.className).not.toMatch(/shadow/)
    expect(thumb.className).not.toMatch(/bg-white/)
  })

  it('toggles on click and reports the new state', () => {
    const onCheckedChange = vi.fn()
    render(<Toggle label="示例" onCheckedChange={onCheckedChange} />)
    const track = screen.getByRole('switch', { name: '示例' })
    expect(track.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(track)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(track.getAttribute('aria-checked')).toBe('true')
  })

  it('does not toggle while disabled', () => {
    const onCheckedChange = vi.fn()
    render(<Toggle label="示例" disabled onCheckedChange={onCheckedChange} />)
    const track = screen.getByRole('switch', { name: '示例' }) as HTMLButtonElement
    expect(track.disabled).toBe(true)
    fireEvent.click(track)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
