import { readdirSync, readFileSync } from 'node:fs'
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
const shellDir = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(shellDir, 'shell.css'), 'utf8')
const css = raw.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

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

function selectorsOf(sheet: string): string[] {
  return [...sheet.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => (m[1] ?? '').split(',').map((part) => part.trim()))
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

  // Only Windows / Linux draw the custom bars; macOS keeps its native overlay scrollbars (system setting, auto-hide).
  const THUMB = ":root:not([data-platform='darwin']) *::-webkit-scrollbar-thumb"

  it('paints the thumb from the tokens, outside any @layer so it beats tailwind.css @layer base', () => {
    expect(declarations(THUMB).background).toBe('var(--scrollbar-thumb)')
    expect(declarations(`${THUMB}:hover`).background).toBe('var(--scrollbar-thumb-hover)')
    expect(css).not.toMatch(/@layer/)
    // No raw colour literal may sneak back into the thumb rules.
    for (const sel of [THUMB, `${THUMB}:hover`]) {
      expect(declarations(sel).background).not.toMatch(/rgb\(|#/)
    }
  })

  it('never styles scrollbars on macOS, where the native overlay bars follow the system setting', () => {
    for (const selector of selectorsOf(css)) {
      if (!selector.includes('::-webkit-scrollbar')) continue
      // Hiding a bar (the tab strip) is platform-neutral; painting or sizing one is not.
      if (declarations(selector).display === 'none') continue
      expect(selector.startsWith(":root:not([data-platform='darwin'])")).toBe(true)
    }
  })
})

describe('shell.css rail tiles', () => {
  it('keeps every rail gradient and nothing else painted with raw colour in :root', () => {
    const root = declarations(':root')
    for (const fn of ['chat', 'autoreply', 'clone', 'tasks', 'todo', 'user'])
      expect(root[`--rail-tile-${fn}`]).toMatch(/^linear-gradient\(/)
    const raw = Object.entries(root)
      .filter(([, v]) => /rgb\(|#[0-9a-f]{3,8}\b/i.test(v))
      .map(([k]) => k)
    expect(raw.sort()).toEqual([
      '--rail-tile-autoreply',
      '--rail-tile-chat',
      '--rail-tile-clone',
      '--rail-tile-tasks',
      '--rail-tile-todo',
      '--rail-tile-user',
      '--scrollbar-thumb',
      '--scrollbar-thumb-hover',
    ])
  })

  it('has no glow: shadows belong to floating layers only (CLAUDE.md §2.1)', () => {
    expect(css).not.toMatch(/--rail-glow/)
    expect(css).not.toMatch(/box-shadow/)
    // a blurred offset shadow never comes back as a token either (e.g. `0 4px 7px rgb(...)`)
    expect(css).not.toMatch(/\d+px\s+\d+px\s+\d+px\s+rgb\(/)
  })
})

describe('shell.css glass (透明效果)', () => {
  const GLASS = ":root[data-glass='true']"
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').trim(),
    body: m[2] ?? '',
  }))

  it('only ever paints under <html data-glass="true">, so the default look stays opaque', () => {
    // Layout rules may target the column classes (e.g. the macOS rail padding); anything that paints them must be glass-scoped.
    const touching = rules.filter((r) => /\.shell-(rail|list|root)\b/.test(r.selector) && /background/.test(r.body))
    expect(touching.length).toBeGreaterThan(0)
    for (const rule of touching) {
      for (const part of rule.selector.split(',')) expect(part.trim().startsWith(GLASS)).toBe(true)
    }
  })

  it('tints the rail and the list with translucent mixes of the palette tokens, never a raw colour', () => {
    const vars = declarations(GLASS)
    expect(vars['--glass-rail']).toMatch(/^color-mix\(in srgb, var\(--bg-panel\) \d+%, transparent\)$/)
    expect(vars['--glass-list']).toMatch(/^color-mix\(in srgb, var\(--bg-shell\) \d+%, transparent\)$/)
    for (const value of Object.values(vars)) expect(value).not.toMatch(/rgb\(|#[0-9a-f]{3,8}\b/i)
    expect(declarations(`${GLASS} .shell-rail`)['background-color']).toBe('var(--glass-rail)')
    const sheet = declarations(`${GLASS} .shell-rail,\n${GLASS} .shell-list`)
    expect(sheet['background-image']).toBe('var(--glass-edge), var(--glass-sheen)')
  })

  it('tints the Agent window sidebar like the object list', () => {
    const sidebar = declarations(`${GLASS} .shell-agent-sidebar`)
    expect(sidebar['background-color']).toBe('var(--glass-list)')
    expect(sidebar['background-image']).toBe('var(--glass-edge), var(--glass-sheen)')
    expect(declarations(`${GLASS} .shell-agent-sidebar [role='search']`)['background-color']).toBe(
      'var(--glass-control)',
    )
  })

  it('lets the native layer through the page base', () => {
    expect(declarations(`${GLASS} body,\n${GLASS} .shell-root`).background).toBe('transparent')
  })
})

describe('shell.css selectors', () => {
  it('reserves one continuous Windows title bar without stepping down only the Agent column', () => {
    expect(declarations('.shell-titlebar').height).toBe('32px')
    expect(declarations('.shell-titlebar').background).toBe('var(--bg-panel)')
    expect(css).not.toContain('.shell-agent-panel:not([hidden])')
    expect(css).not.toContain('var(--caption-inset) - 40px')
  })

  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) =>
    (m[1] ?? '').split(',').map((part) => part.trim()),
  )

  /** Every class token that appears in a string literal of a shell / workspace component. */
  function renderedClasses(): Set<string> {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return files(path)
        return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
      })
    const out = new Set<string>()
    for (const file of [...files(shellDir), ...files(join(shellDir, '..', 'workspace'))]) {
      for (const match of readFileSync(file, 'utf8').matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g))
        for (const token of (match[1] ?? match[2] ?? match[3] ?? '').split(/\s+/)) out.add(token)
    }
    return out
  }

  it('never keys a rule on a test id or on translated copy (AGENTS.md §2.5)', () => {
    // aria-label / title change with the UI language and test ids belong to tests: such a rule silently stops matching.
    expect(selectors.filter((selector) => /\[(data-testid|aria-label|title)\b/.test(selector))).toEqual([])
  })

  it('only targets shell classes that a shell or workspace component renders', () => {
    const referenced = new Set([...css.matchAll(/\.(shell-[\w-]+)/g)].map((m) => m[1] ?? ''))
    const rendered = renderedClasses()
    expect([...referenced].filter((name) => !rendered.has(name))).toEqual([])
  })

  it('makes room for the native window controls through the column classes', () => {
    const mac = "[data-runtime='electron'][data-platform='darwin']"
    expect(declarations(`${mac} .shell-rail`)['padding-top']).toBe('44px')
    // Agent window (CLAUDE.md §12): the sidebar makes room like the rail; the header does once the sidebar is gone.
    expect(declarations(`${mac} .shell-agent-sidebar`)['padding-top']).toBe('44px')
    expect(
      declarations(`${mac} .shell-agent-window[data-sidebar-collapsed='true'] .shell-agent-header`)['padding-left'],
    ).toBe('76px')
    // Native full screen: no traffic lights, so the macOS columns stop reserving their band.
    const full = ":root[data-fullscreen='true']"
    expect(declarations(`${full} ${mac} .shell-rail`)['padding-top']).toBe('14px')
    expect(declarations(`${full} ${mac} .shell-agent-sidebar`)['padding-top']).toBe('0')
  })

  it('makes the Agent window header the drag region and keeps its controls clickable', () => {
    const electron = "[data-runtime='electron']"
    expect(declarations(`${electron} .shell-agent-header`)['-webkit-app-region']).toBe('drag')
    expect(
      declarations(
        `${electron} .shell-agent-header button,\n${electron} .shell-agent-header [role='button'],\n${electron} .shell-agent-header [role='combobox']`,
      )['-webkit-app-region'],
    ).toBe('no-drag')
  })
})
