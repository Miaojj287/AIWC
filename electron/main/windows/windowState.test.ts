import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WINDOW_STATE, debounce, fitToDisplays, loadWindowState, saveWindowState } from './windowState'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-win-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('window state persistence', () => {
  it('returns the 1440x900 default when nothing is saved or the file is corrupt', () => {
    const file = join(dir, 'window-state.json')
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW_STATE)
    writeFileSync(file, 'nope')
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('round-trips and clamps to the minimum size', () => {
    const file = join(dir, 'window-state.json')
    saveWindowState(file, { width: 1500, height: 950, x: 10, y: 20, maximized: true })
    expect(loadWindowState(file)).toEqual({ width: 1500, height: 950, x: 10, y: 20, maximized: true })
    saveWindowState(file, { width: 800, height: 400 })
    expect(loadWindowState(file)).toEqual({ width: 1200, height: 720 })
  })

  it('drops an off-screen position and fits the size to the display', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]
    expect(fitToDisplays({ width: 1440, height: 900, x: 100, y: 50 }, displays)).toEqual({ width: 1440, height: 900, x: 100, y: 50 })
    expect(fitToDisplays({ width: 1440, height: 900, x: 5000, y: 50 }, displays)).toEqual({ width: 1440, height: 900 })
    expect(fitToDisplays({ width: 2600, height: 1400 }, displays)).toEqual({ width: 1920, height: 1080 })
    // second monitor to the right keeps the position
    const two = [...displays, { x: 1920, y: 0, width: 1920, height: 1080 }]
    expect(fitToDisplays({ width: 1440, height: 900, x: 2000, y: 50 }, two).x).toBe(2000)
  })

  it('debounce coalesces calls and flush() runs the last one immediately', () => {
    vi.useFakeTimers()
    const calls: number[] = []
    const d = debounce((n: number) => calls.push(n), 100)
    d(1)
    d(2)
    d(3)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(100)
    expect(calls).toEqual([3])
    d(4)
    d.flush()
    expect(calls).toEqual([3, 4])
    vi.useRealTimers()
  })
})
