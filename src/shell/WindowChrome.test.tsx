import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WindowChrome } from './WindowChrome'

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/platform/bridge', () => ({ bridge: () => ({ invoke }) }))
afterEach(() => { cleanup(); invoke.mockClear() })

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
