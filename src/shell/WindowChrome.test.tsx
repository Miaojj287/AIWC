import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WindowChrome } from './WindowChrome'

import { act } from '@testing-library/react'

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const listeners = vi.hoisted(() => new Map<string, (payload: unknown) => void>())
const fakeBridge = vi.hoisted(() => ({
  invoke,
  on: (channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener)
    return () => listeners.delete(channel)
  },
}))
vi.mock('@/platform/bridge', () => ({ bridge: () => fakeBridge, getBridge: () => Promise.resolve(fakeBridge) }))
afterEach(() => {
  cleanup()
  invoke.mockClear()
  listeners.clear()
})

it('dispatches each window action through the bridge', () => {
  render(<WindowChrome showControls title="会话" />)
  fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))
  fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))
  fireEvent.click(screen.getByRole('button', { name: '切换全屏' }))
  expect(invoke.mock.calls).toEqual([
    ['app:windowControl', { action: 'close' }],
    ['app:windowControl', { action: 'minimize' }],
    ['app:windowControl', { action: 'fullscreen' }],
  ])
  expect(document.title).toBe('会话 — AIWC')
})

it('zooms instead of entering full screen on an Option-click, like the native green light', () => {
  render(<WindowChrome showControls />)
  fireEvent.click(screen.getByRole('button', { name: '切换全屏' }), { altKey: true })
  expect(invoke.mock.calls).toEqual([['app:windowControl', { action: 'zoom' }]])
  fireEvent.keyDown(window, { key: 'Alt', altKey: true })
  expect(screen.getByRole('button', { name: '缩放窗口' })).toBeTruthy()
  fireEvent.keyUp(window, { key: 'Alt', altKey: false })
  expect(screen.getByRole('button', { name: '切换全屏' })).toBeTruthy()
})

it('keeps the lights out of the Tab order and hides them in native full screen', async () => {
  render(<WindowChrome showControls />)
  for (const button of screen.getAllByRole('button')) expect(button.getAttribute('tabindex')).toBe('-1')
  await act(async () => {})
  act(() => listeners.get('app:windowState')?.({ fullscreen: true, maximized: false }))
  expect(screen.queryByRole('group', { name: '窗口控制' })).toBeNull()
  expect(document.documentElement.dataset.fullscreen).toBe('true')
  act(() => listeners.get('app:windowState')?.({ fullscreen: false, maximized: false }))
  expect(screen.getByRole('group', { name: '窗口控制' })).toBeTruthy()
  expect(document.documentElement.dataset.fullscreen).toBeUndefined()
})

it('does not show Mac controls on other platforms', () => {
  render(<WindowChrome />)
  expect(screen.queryByRole('group', { name: '窗口控制' })).toBeNull()
})

it('switches to the inactive appearance on blur', () => {
  render(<WindowChrome showControls />)
  fireEvent.focus(window)
  expect(screen.getByRole('group').getAttribute('data-focused')).toBe('true')
  fireEvent.blur(window)
  expect(screen.getByRole('group').getAttribute('data-focused')).toBe('false')
})
