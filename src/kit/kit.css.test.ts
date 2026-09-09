import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Guards the grey overlay scale (CLAUDE.md §2.1 「到此为止，不要再发明新的灰」):
 *  - kit.css defines exactly the six extra steps beyond tokens.css, for both themes;
 *  - no kit or gallery source re-invents a grey with an ad-hoc `fg/N` alpha, paints a raw
 *    `bg-white`, or puts a shadow on a non-floating control.
 * Also guards the single modal scrim (`--scrim`, shared by Dialog and Drawer through `.kit-overlay`) and
 * keeps kit sources on the type / radius / line-height scale (no `text-[Npx]` / `rounded-[Npx]` / `leading-[Npx]`).
 */
// Read via node:fs — vitest's CSS pipeline returns '' for .css imports, and the jsdom URL global is not a Node URL.
const kitDir = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(kitDir, 'kit.css'), 'utf8')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

const EXTRA_STEPS = ['--fill-13', '--line-16', '--fill-20', '--line-25', '--fill-28', '--line-40'] as const

function declarations(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((m[1] ?? '').trim() !== selector) continue
    for (const line of (m[2] ?? '').split(';')) {
      const idx = line.indexOf(':')
      if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return out
}

function rgb(value: string | undefined): { r: number; g: number; b: number; a: number } {
  const m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/.exec(value ?? '')
  if (!m) throw new Error(`not an rgb() overlay: ${String(value)}`)
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) }
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('kit.css grey overlay scale', () => {
  it('defines the six extra steps as white overlays for the dark (default) theme, in ascending order', () => {
    const root = declarations(':root')
    const alphas = EXTRA_STEPS.map((name) => {
      const c = rgb(root[name])
      expect([c.r, c.g, c.b], name).toEqual([255, 255, 255])
      return c.a
    })
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1] ?? 0)
    // Every step sits above tokens.css's strongest built-in overlay (line-10) and below opaque.
    expect(alphas[0]).toBeGreaterThan(0.1)
    expect(alphas[alphas.length - 1]).toBeLessThan(1)
  })

  it('flips all six steps to black overlays under data-theme="light"', () => {
    const light = declarations(":root[data-theme='light']")
    const alphas = EXTRA_STEPS.map((name) => {
      const c = rgb(light[name])
      expect([c.r, c.g, c.b], name).toEqual([0, 0, 0])
      return c.a
    })
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1] ?? 0)
  })

  it('does not define any grey overlay beyond the six steps', () => {
    const defined = Object.keys(declarations(':root')).filter((k) => /^--(fill|line|hover)-\d+$/.test(k))
    expect(defined.sort()).toEqual([...EXTRA_STEPS].sort())
  })
})

describe('kit sources use only named greys', () => {
  const files = [...sourceFiles(kitDir), ...sourceFiles(join(kitDir, '..', 'features', 'kit'))]

  it('scans the kit and its gallery', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('never invents a grey with an ad-hoc fg/N alpha', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/[\w-]*\bfg(?:-[23])?\/\d+\b/g)) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('paints no raw white and puts no shadow on a non-floating control', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (/\bbg-white\b/.test(src)) offenders.push(`${file}: bg-white`)
      if (/shadow-\[/.test(src)) offenders.push(`${file}: arbitrary shadow`)
    }
    expect(offenders).toEqual([])
  })
})

describe('kit.css scrim', () => {
  it('declares --scrim exactly once, as a black overlay strictly between transparent and opaque', () => {
    expect(css.match(/--scrim\s*:/g)).toHaveLength(1)
    const c = rgb(declarations(':root')['--scrim'])
    expect([c.r, c.g, c.b]).toEqual([0, 0, 0])
    expect(c.a).toBeGreaterThan(0)
    expect(c.a).toBeLessThan(1)
  })

  it('paints .kit-overlay with var(--scrim) so Dialog and Drawer share one scrim', () => {
    expect(declarations('.kit-overlay').background).toBe('var(--scrim)')
    for (const name of ['Dialog.tsx', 'Drawer.tsx']) {
      const src = readFileSync(join(kitDir, name), 'utf8')
      expect(src, name).toContain('kit-overlay')
    }
  })

  it('lets no kit source add a second scrim opacity (bg-black/N)', () => {
    const files = [...sourceFiles(kitDir), ...sourceFiles(join(kitDir, '..', 'features', 'kit'))]
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\bbg-black(?:\/\d+)?\b/g)) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('kit sources stay on the type / radius scale', () => {
  const files = [...sourceFiles(kitDir), ...sourceFiles(join(kitDir, '..', 'features', 'kit'))]

  it('never sets a font size with text-[Npx]; use text-micro/note/caption/tab/body/bubble/title/wizard', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\btext-\[[^\]]*px\]/g)) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('never sets a radius with rounded-[Npx]; use rounded-sm/control/item/window/card/chip', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\brounded(?:-[a-z]+)?-\[[^\]]*px\]/g)) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('never sets a line-height with leading-[Npx]; use leading-4 / leading-4.5 / leading-5 (16 / 18 / 20 px)', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\bleading-\[[^\]]*px\]/g)) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })
})
