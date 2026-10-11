import { fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installWindowFocus } from './windowFocus'

it('stamps the window focus on <html> and follows blur / focus', () => {
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const dispose = installWindowFocus()
  expect(document.documentElement.dataset.windowFocus).toBe('true')
  hasFocus.mockReturnValue(false)
  fireEvent.blur(window)
  expect(document.documentElement.dataset.windowFocus).toBe('false')
  hasFocus.mockReturnValue(true)
  fireEvent.focus(window)
  expect(document.documentElement.dataset.windowFocus).toBe('true')
  dispose()
  expect(document.documentElement.dataset.windowFocus).toBeUndefined()
  hasFocus.mockRestore()
})
