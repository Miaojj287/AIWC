/**
 * LaunchSplash — the loading moment before the first screen (welcome or the returning connect page). Particles
 * stream left to right through a dot-matrix AIWC wordmark and light it up letter by letter; the I takes the
 * accent, everything else is derived from the current theme's shell / foreground tokens. It stays until the app is
 * ready and the reveal has played once, then fades out over whatever mounted underneath.
 *
 * Drawn on a canvas: ~1–2k dots at 60 fps is a canvas job, not a DOM one. Without a 2D context (tests, a broken
 * GPU process) it finishes immediately rather than blocking the app.
 */
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/kit'
import {
  SPLASH_TIMING,
  buildWordDots,
  clamp01,
  dotBrightness,
  mixRgb,
  parseCanvasColor,
  rgbCss,
  revealFront,
  spawnParticle,
  type Particle,
  type Rgb,
  type WordDot,
} from './splashField'

export interface LaunchSplashProps {
  /** The app can show its first screen (config hydrated); the splash never ends before this. */
  ready: boolean
  /** The fade-out finished; unmount the splash. */
  onFinished(): void
}

const LETTERS = ['A', 'I', 'W', 'C'] as const
const ACCENT_LETTER = 1
/** Cap height of the wordmark in grid rows, and its target width in grid columns. */
const CAP_ROWS = 15
const TARGET_COLS = 58
const MAX_WORDMARK_PX = 600
const PARTICLE_COUNT = 110
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", "Helvetica Neue", sans-serif'
const FALLBACK: Rgb = { r: 128, g: 128, b: 128 }

interface Field {
  width: number
  height: number
  cell: number
  cols: number
  rows: number
  originX: number
  originY: number
  dots: (WordDot & { lit: Rgb })[]
  accentCenter: { x: number; y: number }
  bandTop: number
  bandHeight: number
  bg: Rgb
  fg: Rgb
  accent: Rgb
}

function readTokens(ctx: CanvasRenderingContext2D): { bg: Rgb; fg: Rgb; accent: Rgb } {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => {
    const raw = style.getPropertyValue(name).trim()
    if (!raw) return FALLBACK
    ctx.fillStyle = raw
    return parseCanvasColor(String(ctx.fillStyle), FALLBACK)
  }
  return { bg: read('--bg-shell'), fg: read('--fg'), accent: read('--accent') }
}

/** Per-cell coverage of the wordmark (and of the accent letter alone), sampled from real glyphs. */
function sampleGlyphs(cell: number, fontPx: number) {
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null
  probe.font = `700 ${fontPx}px ${FONT_STACK}`
  const widths = LETTERS.map((l) => probe.measureText(l).width)
  const gap = fontPx * 0.3
  const textWidth = widths.reduce((a, b) => a + b, 0) + gap * (LETTERS.length - 1)
  const ascent = probe.measureText('A').actualBoundingBoxAscent || fontPx * 0.72
  const margin = 2
  const cols = Math.ceil(textWidth / cell) + margin * 2
  const rows = Math.ceil(ascent / cell) + margin * 2
  const draw = (only?: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = cols * cell
    canvas.height = rows * cell
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.font = probe.font
    ctx.fillStyle = 'white'
    ctx.textBaseline = 'alphabetic'
    let x = margin * cell + (cols * cell - margin * 2 * cell - textWidth) / 2
    LETTERS.forEach((letter, i) => {
      if (only === undefined || only === i) ctx.fillText(letter, x, margin * cell + ascent)
      x += (widths[i] ?? 0) + gap
    })
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const grid = new Float32Array(cols * rows)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let sum = 0
        for (let y = 0; y < cell; y++) {
          const base = ((row * cell + y) * canvas.width + col * cell) * 4 + 3
          for (let xx = 0; xx < cell; xx++) sum += data[base + xx * 4] ?? 0
        }
        grid[row * cols + col] = sum / (cell * cell * 255)
      }
    }
    return grid
  }
  const all = draw()
  const accent = draw(ACCENT_LETTER)
  if (!all || !accent) return null
  return { all, accent, cols, rows }
}

function buildField(ctx: CanvasRenderingContext2D, width: number, height: number): Field | null {
  const target = Math.min(MAX_WORDMARK_PX, width * 0.52)
  const cell = Math.max(6, Math.min(14, Math.round(target / TARGET_COLS)))
  const sampled = sampleGlyphs(cell, (CAP_ROWS * cell) / 0.72)
  if (!sampled) return null
  const { bg, fg, accent } = readTokens(ctx)
  const { cols, rows } = sampled
  const dots = buildWordDots(sampled.all, sampled.accent, cols, rows).map((d) => ({
    ...d,
    // Fully lit colour: the core of a letter approaches the text colour, its fringe stays close to the ground.
    lit: d.accent ? mixRgb(bg, accent, 0.3 + 0.7 * d.level) : mixRgb(bg, fg, 0.18 + 0.68 * d.level),
  }))
  const accentDots = dots.filter((d) => d.accent)
  const mean = (pick: (d: WordDot) => number) =>
    accentDots.length ? accentDots.reduce((s, d) => s + pick(d), 0) / accentDots.length : 0
  const originX = (width - cols * cell) / 2
  const originY = height * 0.46 - (rows * cell) / 2
  return {
    width,
    height,
    cell,
    cols,
    rows,
    originX,
    originY,
    dots,
    accentCenter: { x: originX + (mean((d) => d.col) + 0.5) * cell, y: originY + (mean((d) => d.row) + 0.5) * cell },
    bandTop: originY - cell * 3,
    bandHeight: rows * cell + cell * 6,
    bg,
    fg,
    accent,
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  field: Field,
  particles: Particle[],
  elapsed: number,
  reduced: boolean,
) {
  const { cell, cols, originX, originY } = field
  ctx.fillStyle = rgbCss(field.bg)
  ctx.fillRect(0, 0, field.width, field.height)

  // A faint accent glow behind the I as it lights (the reference design's warm halo, in the theme's accent).
  const glowLevel = reduced ? clamp01(elapsed / SPLASH_TIMING.reducedTotal) : clamp01(revealFront(elapsed) * 1.4 - 0.2)
  if (glowLevel > 0) {
    const radius = field.rows * cell * 1.15
    const glow = ctx.createRadialGradient(
      field.accentCenter.x,
      field.accentCenter.y,
      0,
      field.accentCenter.x,
      field.accentCenter.y,
      radius,
    )
    glow.addColorStop(0, rgbCss(field.accent, 0.12 * glowLevel))
    glow.addColorStop(1, rgbCss(field.accent, 0))
    ctx.fillStyle = glow
    ctx.fillRect(field.accentCenter.x - radius, field.accentCenter.y - radius, radius * 2, radius * 2)
  }

  for (const p of particles) {
    const color = rgbCss(p.accent ? field.accent : mixRgb(field.bg, field.fg, 0.55), p.alpha)
    ctx.strokeStyle = rgbCss(p.accent ? field.accent : mixRgb(field.bg, field.fg, 0.55), p.alpha * 0.3)
    ctx.lineWidth = p.size
    ctx.beginPath()
    ctx.moveTo(p.x - p.speed * 0.04, p.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const d of field.dots) {
    const b = reduced
      ? clamp01(elapsed / SPLASH_TIMING.reducedTotal)
      : dotBrightness((d.col + 0.5) / cols, elapsed, d.jitter)
    // Unlit dots remain as a barely-there ghost of the letters, so the wordmark is "filled in", not drawn on.
    const tone = 0.07 + 0.93 * b
    const radius = cell * (0.06 + 0.42 * d.level ** 0.85) * (0.5 + 0.5 * b)
    ctx.fillStyle = rgbCss(mixRgb(field.bg, d.lit, tone))
    ctx.beginPath()
    ctx.arc(originX + (d.col + 0.5) * cell, originY + (d.row + 0.5) * cell, radius, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function LaunchSplash({ ready, onFinished }: LaunchSplashProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const readyRef = useRef(ready)
  const finishedRef = useRef(onFinished)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    readyRef.current = ready
    finishedRef.current = onFinished
  }, [ready, onFinished])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    let raf = 0
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      setLeaving(true)
      fadeTimer = setTimeout(() => finishedRef.current(), SPLASH_TIMING.fadeOut)
    }
    if (!canvas || !ctx) {
      // No canvas (jsdom, lost GPU): wait for readiness only.
      const poll = () => (readyRef.current ? finishedRef.current() : (raf = requestAnimationFrame(poll)))
      poll()
      return () => cancelAnimationFrame(raf)
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let field: Field | null = null
    let particles: Particle[] = []
    let seed = 1
    const layout = () => {
      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      field = buildField(ctx, width, height)
      particles = reduced
        ? []
        : Array.from({ length: PARTICLE_COUNT }, () =>
            spawnParticle(seed++, width, field?.bandTop ?? 0, field?.bandHeight ?? height, true),
          )
    }
    layout()
    if (!field) {
      const poll = () => (readyRef.current ? finishedRef.current() : (raf = requestAnimationFrame(poll)))
      poll()
      return () => cancelAnimationFrame(raf)
    }
    const start = performance.now()
    let last = start
    let done = false
    const endAt = reduced ? SPLASH_TIMING.reducedTotal : SPLASH_TIMING.revealEnd + SPLASH_TIMING.hold
    const tick = (now: number) => {
      const elapsed = now - start
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const f = field
      if (f) {
        // The stream keeps flowing while the app is still loading; once it is ready no new particles enter.
        const spawning = !readyRef.current || elapsed < SPLASH_TIMING.revealEnd
        particles = particles.flatMap((p) => {
          const moved = { ...p, x: p.x + p.speed * dt }
          if (moved.x < f.width + 24) return [moved]
          return spawning ? [spawnParticle(seed++, f.width, f.bandTop, f.bandHeight, false)] : []
        })
        drawFrame(ctx, f, particles, elapsed, reduced)
      }
      if (!done && elapsed >= endAt && readyRef.current) {
        done = true
        finish()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onResize = () => layout()
    window.addEventListener('resize', onResize)
    // The saved theme / palette can land after the first frame (a first launch has nothing cached for themeBoot):
    // rebuild with the new tokens so the splash never shows the wrong mode.
    const themeWatch = new MutationObserver(() => layout())
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    })
    return () => {
      cancelAnimationFrame(raf)
      if (fadeTimer) clearTimeout(fadeTimer)
      window.removeEventListener('resize', onResize)
      themeWatch.disconnect()
    }
  }, [])

  return (
    <div
      role="status"
      aria-label={t('app.starting')}
      className={cn(
        'fixed inset-0 z-[70] bg-shell transition-opacity duration-(--dur-surface)',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
    </div>
  )
}
