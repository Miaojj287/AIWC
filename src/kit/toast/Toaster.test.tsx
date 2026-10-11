import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Toaster } from './Toaster'
import { clearToasts, toast } from './toastStore'

afterEach(() => {
  cleanup()
  clearToasts()
  vi.useRealTimers()
})

it('keeps a notification available while a keyboard user is focused inside it', () => {
  vi.useFakeTimers()
  render(<Toaster />)
  act(() => {
    toast.info('Operation complete')
  })
  fireEvent.focus(screen.getByRole('button', { name: '关闭' }))
  act(() => {
    vi.advanceTimersByTime(5000)
  })
  expect(screen.queryByText('Operation complete')).not.toBeNull()
  fireEvent.blur(screen.getByRole('button', { name: '关闭' }), { relatedTarget: document.body })
  act(() => {
    vi.advanceTimersByTime(4000)
  })
  expect(screen.queryByText('Operation complete')).toBeNull()
})
