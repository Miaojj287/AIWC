import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoomPan } from './ZoomPan'

afterEach(cleanup)

const level = () => screen.getByText(/^\d+%$/).textContent

describe('<ZoomPan>', () => {
  it('zooms with + / − and the toolbar, and resets with 0 or a double-click', () => {
    render(
      <ZoomPan label="截图">
        <img src="data:image/png;base64,AAAA" alt="截图" />
      </ZoomPan>,
    )
    const viewport = screen.getByRole('group', { name: '截图' })
    expect(level()).toBe('100%')
    fireEvent.keyDown(viewport, { key: '+' })
    expect(level()).toBe('125%')
    fireEvent.keyDown(viewport, { key: '0' })
    expect(level()).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(level()).toBe('80%')
    fireEvent.doubleClick(viewport)
    expect(level()).toBe('100%')
  })

  it('zooms with the wheel without scrolling the page', () => {
    render(
      <ZoomPan label="图">
        <span>x</span>
      </ZoomPan>,
    )
    const viewport = screen.getByRole('group', { name: '图' })
    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true })
    act(() => {
      viewport.dispatchEvent(wheel)
    })
    expect(wheel.defaultPrevented).toBe(true)
    expect(Number(level()?.replace('%', ''))).toBeGreaterThan(100)
  })
})
