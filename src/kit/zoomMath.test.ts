import { describe, expect, it } from 'vitest'
import { clampScale, panBy, wheelFactor, ZOOM_IDENTITY, ZOOM_MAX, ZOOM_MIN, zoomAt, zoomPercent } from './zoomMath'

describe('zoomPan', () => {
  it('keeps the point under the cursor in place while zooming', () => {
    const next = zoomAt(ZOOM_IDENTITY, 2, { x: 100, y: 50 })
    expect(next).toEqual({ scale: 2, x: -100, y: -50 })
    // the content point that was under the cursor (100, 50) maps back to the cursor
    expect(100 * next.scale + next.x).toBe(100)
    expect(50 * next.scale + next.y).toBe(50)
  })

  it('clamps the scale and leaves the state alone at a bound', () => {
    expect(clampScale(100)).toBe(ZOOM_MAX)
    expect(clampScale(0)).toBe(ZOOM_MIN)
    const max = { scale: ZOOM_MAX, x: 3, y: 4 }
    expect(zoomAt(max, 2, { x: 0, y: 0 })).toBe(max)
  })

  it('weighs pinches more than wheel notches, zooming in on a negative delta', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1)
    expect(wheelFactor(100, false)).toBeLessThan(1)
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false))
  })

  it('pans and reports a whole percentage', () => {
    expect(panBy(ZOOM_IDENTITY, 5, -7)).toEqual({ scale: 1, x: 5, y: -7 })
    expect(zoomPercent({ scale: 1.256, x: 0, y: 0 })).toBe(126)
  })
})
