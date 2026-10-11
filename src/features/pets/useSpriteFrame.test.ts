// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PET_ANIMATIONS } from './spriteSpec'
import { useSpriteFrame } from './useSpriteFrame'

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  setHidden(false)
  vi.useRealTimers()
})

it('holds the current frame while the document is hidden and resumes from it', () => {
  const durations = PET_ANIMATIONS.idle.durations
  const first = durations[0] ?? 0
  const { result } = renderHook(() => useSpriteFrame('idle', { playing: true }))
  expect(result.current).toBe(0)
  act(() => vi.advanceTimersByTime(first))
  expect(result.current).toBe(1)

  act(() => setHidden(true))
  act(() => vi.advanceTimersByTime(60_000))
  expect(result.current).toBe(1)

  act(() => setHidden(false))
  act(() => vi.advanceTimersByTime(durations[1] ?? 0))
  expect(result.current).toBe(2 % durations.length)
})
