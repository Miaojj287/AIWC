// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

const options = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const

function Harness({ onChange, disabledValue }: { onChange?: (v: string) => void; disabledValue?: string }) {
  const [value, setValue] = useState<string>('dark')
  return (
    <SegmentedControl
      aria-label="主题"
      options={options.map((o) => ({ ...o, disabled: o.value === disabledValue }))}
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with only the selected segment tabbable', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: '主题' })
    const radios = screen.getAllByRole('radio')
    expect(group).toBeTruthy()
    expect(radios).toHaveLength(3)
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true')
    expect(radios[1]?.getAttribute('tabindex')).toBe('0')
    expect(radios[0]?.getAttribute('tabindex')).toBe('-1')
  })

  it('moves and selects with arrow keys, wrapping at the ends, and jumps with Home / End', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const [light, dark, system] = screen.getAllByRole('radio')
    dark!.focus()

    fireEvent.keyDown(dark!, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('system')
    expect(document.activeElement).toBe(system)

    fireEvent.keyDown(system!, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('light')
    expect(document.activeElement).toBe(light)

    fireEvent.keyDown(light!, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('system')

    fireEvent.keyDown(system!, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('light')
    fireEvent.keyDown(light!, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('system')
  })

  it('skips disabled segments', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} disabledValue="system" />)
    const [light, dark] = screen.getAllByRole('radio')
    dark!.focus()
    fireEvent.keyDown(dark!, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('light')
    expect(document.activeElement).toBe(light)
  })

  it('selects on click', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '浅色' }))
    expect(onChange).toHaveBeenCalledWith('light')
    expect(screen.getByRole('radio', { name: '浅色' }).getAttribute('aria-checked')).toBe('true')
  })
})
