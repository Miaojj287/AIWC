import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Guards the theme-aware scrollbar thumb override in shell.css. src/styles/tailwind.css paints the
 * thumb with raw white overlays inside @layer base, so in light theme it would vanish; shell.css
 * must keep overriding it with tokens that flip on <html data-theme="light">.
 */
// Read via node:fs — vitest's CSS pipeline returns '' for .css imports (even with ?raw), and the
// jsdom global URL is not a Node URL, so pass import.meta.url to fileURLToPath as a string.
const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'shell.css'), 'utf8')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

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

describe('shell.css scrollbar thumb', () => {
  it('defines white overlay tokens for the dark (default) theme, hover stronger than rest', () => {
    const root = declarations(':root')
    const rest = rgb(root['--scrollbar-thumb'])
    const hover = rgb(root['--scrollbar-thumb-hover'])
    expect([rest.r, rest.g, rest.b]).toEqual([255, 255, 255])
    expect([hover.r, hover.g, hover.b]).toEqual([255, 255, 255])
    expect(rest.a).toBeGreaterThan(0)
    expect(hover.a).toBeGreaterThan(rest.a)
    expect(hover.a).toBeLessThan(1)
  })

  it('flips both tokens to black overlays under data-theme="light"', () => {
    const light = declarations(":root[data-theme='light']")
    const rest = rgb(light['--scrollbar-thumb'])
    const hover = rgb(light['--scrollbar-thumb-hover'])
    expect([rest.r, rest.g, rest.b]).toEqual([0, 0, 0])
    expect([hover.r, hover.g, hover.b]).toEqual([0, 0, 0])
    expect(hover.a).toBeGreaterThan(rest.a)
  })

  it('paints the thumb from the tokens, outside any @layer so it beats tailwind.css @layer base', () => {
    expect(declarations('*::-webkit-scrollbar-thumb').background).toBe('var(--scrollbar-thumb)')
    expect(declarations('*::-webkit-scrollbar-thumb:hover').background).toBe('var(--scrollbar-thumb-hover)')
    expect(css).not.toMatch(/@layer/)
    // No raw colour literal may sneak back into the thumb rules.
    for (const sel of ['*::-webkit-scrollbar-thumb', '*::-webkit-scrollbar-thumb:hover']) {
      expect(declarations(sel).background).not.toMatch(/rgb\(|#/)
    }
  })
})

describe('shell.css rail tiles', () => {
  it('keeps the four rail gradients and nothing else painted with raw colour in :root', () => {
    const root = declarations(':root')
    for (const fn of ['chat', 'autoreply', 'clone', 'user']) expect(root[`--rail-tile-${fn}`]).toMatch(/^linear-gradient\(/)
    const raw = Object.entries(root).filter(([, v]) => /rgb\(|#[0-9a-f]{3,8}\b/i.test(v)).map(([k]) => k)
    expect(raw.sort()).toEqual(['--rail-tile-autoreply', '--rail-tile-chat', '--rail-tile-clone', '--rail-tile-user', '--scrollbar-thumb', '--scrollbar-thumb-hover'])
  })

  it('has no glow: shadows belong to floating layers only (CLAUDE.md §2.1)', () => {
    expect(css).not.toMatch(/--rail-glow/)
    expect(css).not.toMatch(/box-shadow/)
    // a blurred offset shadow never comes back as a token either (e.g. `0 4px 7px rgb(...)`)
    expect(css).not.toMatch(/\d+px\s+\d+px\s+\d+px\s+rgb\(/)
  })
})
