import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorField, normalizeHex } from './ColorField'
afterEach(cleanup)
describe('ColorField', () => {
  it('normalizes shorthand and rejects incomplete or invalid hex', () => {
    expect(normalizeHex(' ABC ')).toBe('#aabbcc')
    expect(normalizeHex('#123456')).toBe('#123456')
    expect(normalizeHex('#12')).toBeUndefined()
    expect(normalizeHex('orange')).toBeUndefined()
  })
  it('commits valid text once on Enter and blur, keeping invalid text out of config', () => {
    const commit = vi.fn()
    render(<ColorField id="test" label="背景" value="#ffffff" onCommit={commit} />)
    const field = screen.getByLabelText('背景')
    fireEvent.change(field, { target: { value: '#abc' } })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('#aabbcc')
    fireEvent.change(field, { target: { value: '#xy' } })
    fireEvent.blur(field)
    expect(screen.getByRole('alert').textContent).toContain('十六进制')
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('keeps 100 picker updates local and saves only the final gesture', () => {
    const commit = vi.fn()
    render(<ColorField id="test" label="强调色" value="#ff0000" onCommit={commit} />)
    fireEvent.click(screen.getByRole('button', { name: '强调色取色器' }))
    const hue = screen.getByLabelText('强调色色相')
    fireEvent.pointerDown(hue)
    for (let value = 1; value <= 100; value++) fireEvent.change(hue, { target: { value: String(value) } })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(hue)
    fireEvent.blur(hue)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
