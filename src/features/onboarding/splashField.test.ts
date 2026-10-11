import { describe, expect, it } from 'vitest'
import {
  SPLASH_TIMING,
  blurGrid,
  buildWordDots,
  dotBrightness,
  parseCanvasColor,
  revealFront,
  spawnParticle,
} from './splashField'

const FALLBACK = { r: 1, g: 2, b: 3 }

describe('splash field', () => {
  it('reveals the wordmark left to right: nothing lit before the sweep, everything lit after it', () => {
    expect(dotBrightness(0, 0, 0)).toBe(0)
    expect(dotBrightness(1, 0, 0)).toBe(0)
    const mid = (SPLASH_TIMING.revealStart + SPLASH_TIMING.revealEnd) / 2
    expect(dotBrightness(0.05, mid, 0)).toBeGreaterThan(dotBrightness(0.95, mid, 0))
    expect(dotBrightness(0, SPLASH_TIMING.revealEnd, 0)).toBe(1)
    expect(dotBrightness(1, SPLASH_TIMING.revealEnd, 0)).toBe(1)
    expect(revealFront(SPLASH_TIMING.revealEnd)).toBeGreaterThan(1)
  })

  it('turns glyph coverage into bright core dots, a dim halo, and marks the accent letter', () => {
    const cols = 7
    const rows = 3
    const coverage = new Float32Array(cols * rows)
    const accent = new Float32Array(cols * rows)
    coverage[1 * cols + 1] = 1 // a plain letter cell…
    coverage[0 * cols + 1] = 1 // …with some body above it
    coverage[1 * cols + 5] = 1 // the accent letter cell
    accent[1 * cols + 5] = 1
    const dots = buildWordDots(coverage, accent, cols, rows)
    const at = (col: number, row: number) => dots.find((d) => d.col === col && d.row === row)
    expect(at(1, 1)).toMatchObject({ level: 1, accent: false })
    expect(at(5, 1)).toMatchObject({ level: 1, accent: true })
    // A neighbour only gets a halo dot, much dimmer than the core.
    expect(at(2, 1)?.level).toBeLessThan(0.2)
    // Far from any glyph there is nothing.
    expect(at(3, 1)).toBeUndefined()
  })

  it('blurs without leaking outside the grid', () => {
    const grid = new Float32Array([1, 0, 0, 0])
    const out = blurGrid(grid, 2, 2, 1)
    expect(out[0]).toBeCloseTo(0.25)
    expect(out[3]).toBeCloseTo(0.25)
  })

  it('parses the colour forms a canvas normalises to and falls back on anything else', () => {
    expect(parseCanvasColor('#4e82ef', FALLBACK)).toEqual({ r: 78, g: 130, b: 239 })
    expect(parseCanvasColor('rgba(24, 24, 24, 0.5)', FALLBACK)).toEqual({ r: 24, g: 24, b: 24 })
    expect(parseCanvasColor('color(display-p3 1 0 0)', FALLBACK)).toBe(FALLBACK)
  })

  it('spawns particles inside the band, entering from the left unless scattered', () => {
    const p = spawnParticle(7, 1000, 100, 50, false)
    expect(p.x).toBeLessThan(0)
    expect(p.y).toBeGreaterThanOrEqual(100)
    expect(p.y).toBeLessThanOrEqual(150)
    expect(spawnParticle(7, 1000, 100, 50, false)).toEqual(p)
  })
})
