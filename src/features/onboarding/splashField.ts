/**
 * Pure maths of the launch splash (LaunchSplash.tsx): the AIWC wordmark as a dot matrix sampled from glyph coverage,
 * the left-to-right reveal and the particle stream. No DOM here, so the timeline and the field are unit-tested.
 */

/** One wordmark dot in grid units; `level` 0..1 drives both radius and brightness. */
export interface WordDot {
  col: number
  row: number
  level: number
  accent: boolean
  /** Per-dot jitter (ms) so the lit edge reads as particles arriving, not a hard wipe. */
  jitter: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Below this the halo is too faint to draw a dot at all. */
const MIN_LEVEL = 0.05
/** The halo (blurred glyphs) only ever produces dim outer dots, like the reference design's grey fringe. */
const HALO_WEIGHT = 0.42

/** Timeline (ms). The reveal sweeps the wordmark once; the splash ends after the hold once the app is ready. */
export const SPLASH_TIMING = {
  revealStart: 250,
  revealEnd: 1500,
  hold: 350,
  fadeOut: 280,
  reducedTotal: 650,
} as const

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const smoothstep = (v: number): number => {
  const x = clamp01(v)
  return x * x * (3 - 2 * x)
}

export const easeInOutCubic = (v: number): number => {
  const x = clamp01(v)
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

/** Deterministic 0..1 noise from integer coordinates, so the field looks the same on every launch. */
export function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Box blur over a cols×rows grid (radius in cells), used for the dim halo around the glyphs. */
export function blurGrid(grid: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const out = new Float32Array(grid.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0
      let n = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue
          sum += grid[yy * cols + xx] ?? 0
          n++
        }
      }
      out[y * cols + x] = n ? sum / n : 0
    }
  }
  return out
}

/**
 * Turn per-cell glyph coverage (0..1) into wordmark dots. `accentCoverage` is the coverage of the accent letter
 * alone (the I); a dot belongs to it when that letter dominates the cell.
 */
export function buildWordDots(
  coverage: Float32Array,
  accentCoverage: Float32Array,
  cols: number,
  rows: number,
): WordDot[] {
  const halo = blurGrid(coverage, cols, rows, 1)
  const accentHalo = blurGrid(accentCoverage, cols, rows, 1)
  const dots: WordDot[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const core = coverage[i] ?? 0
      const level = Math.max(core, (halo[i] ?? 0) * HALO_WEIGHT)
      if (level < MIN_LEVEL) continue
      const accentShare = (accentHalo[i] ?? 0) / Math.max(halo[i] ?? 0, 1e-6)
      dots.push({ col, row, level, accent: accentShare > 0.5, jitter: (hash01(col, row) - 0.5) * 140 })
    }
  }
  return dots
}

/** Where the lit edge is (0..1 across the wordmark, may overshoot both ends) at `elapsed` ms. */
export function revealFront(elapsed: number): number {
  const { revealStart, revealEnd } = SPLASH_TIMING
  const p = easeInOutCubic((elapsed - revealStart) / (revealEnd - revealStart))
  return -0.2 + p * 1.45
}

/** Brightness 0..1 of a dot at horizontal position `x` (0..1 across the wordmark). */
export function dotBrightness(x: number, elapsed: number, jitter: number): number {
  const front = revealFront(elapsed + jitter)
  return smoothstep((front - x) / 0.22)
}

/** Linear mix of two colours, t = 0 → a, 1 → b. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t)
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k }
}

export const rgbCss = (c: Rgb, alpha = 1): string =>
  `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)} / ${alpha})`

/**
 * Parse the forms a canvas normalises `fillStyle` to: `#rrggbb` and `rgb(a)(r, g, b[, a])`. Anything else falls back,
 * so an exotic token value can never break the splash.
 */
export function parseCanvasColor(value: string, fallback: Rgb): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value.trim())
  if (rgb?.[1] && rgb[2] && rgb[3]) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  return fallback
}

/** A particle of the left-to-right stream. Positions are in CSS px of the splash. */
export interface Particle {
  x: number
  y: number
  speed: number
  size: number
  alpha: number
  accent: boolean
}

/** Seeded particle spawn so the stream is reproducible; `seed` advances per particle. */
export function spawnParticle(seed: number, width: number, bandTop: number, bandHeight: number, scatter: boolean) {
  const r1 = hash01(seed, 11)
  const r2 = hash01(seed, 23)
  const r3 = hash01(seed, 37)
  const r4 = hash01(seed, 53)
  const p: Particle = {
    x: scatter ? r1 * width : -20 - r1 * width * 0.25,
    y: bandTop + r2 * bandHeight,
    speed: width * (0.45 + r3 * 0.75),
    size: 0.7 + r4 * 1.3,
    alpha: 0.25 + r3 * 0.55,
    accent: r4 > 0.86,
  }
  return p
}
