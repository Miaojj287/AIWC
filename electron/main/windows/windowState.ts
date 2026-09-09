/**
 * Remember the main window's size / position between launches. Pure helpers (fs only) — the
 * BrowserWindow wiring lives in mainWindow.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { atomicWriteJson } from '../config/configService'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900 }
export const MIN_WINDOW_WIDTH = 1200
export const MIN_WINDOW_HEIGHT = 720

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function loadWindowState(file: string): WindowState {
  if (!existsSync(file)) return { ...DEFAULT_WINDOW_STATE }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<WindowState>
    const state: WindowState = {
      width: isNum(raw.width) ? Math.max(MIN_WINDOW_WIDTH, Math.round(raw.width)) : DEFAULT_WINDOW_STATE.width,
      height: isNum(raw.height) ? Math.max(MIN_WINDOW_HEIGHT, Math.round(raw.height)) : DEFAULT_WINDOW_STATE.height,
    }
    if (isNum(raw.x) && isNum(raw.y)) {
      state.x = Math.round(raw.x)
      state.y = Math.round(raw.y)
    }
    if (raw.maximized === true) state.maximized = true
    return state
  } catch {
    return { ...DEFAULT_WINDOW_STATE }
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  atomicWriteJson(file, state)
}

/**
 * If the remembered position is not (mostly) visible on any current display, drop x/y so the OS
 * centres the window; also shrink the size so it fits the display it lands on.
 */
export function fitToDisplays(state: WindowState, displays: readonly DisplayBounds[]): WindowState {
  if (displays.length === 0) return { ...state }
  const primary = displays[0]!
  const out: WindowState = { ...state }

  const largest = displays.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b))
  out.width = Math.min(out.width, largest.width)
  out.height = Math.min(out.height, largest.height)

  if (out.x === undefined || out.y === undefined) return out

  const visibleOn = displays.some((d) => {
    const minVisible = 100
    const right = out.x! + out.width
    const bottom = out.y! + out.height
    return right - minVisible > d.x && out.x! + minVisible < d.x + d.width && bottom - minVisible > d.y && out.y! + minVisible < d.y + d.height
  })
  if (!visibleOn) {
    delete out.x
    delete out.y
    out.width = Math.min(out.width, primary.width)
    out.height = Math.min(out.height, primary.height)
  }
  return out
}

/** Coalesce rapid resize/move events into one write. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: A | undefined
  const wrapped = ((...args: A) => {
    pending = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      const a = pending
      pending = undefined
      if (a) fn(...a)
    }, ms)
  }) as ((...args: A) => void) & { flush(): void }
  wrapped.flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const a = pending
    pending = undefined
    if (a) fn(...a)
  }
  return wrapped
}
