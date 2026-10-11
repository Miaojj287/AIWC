/**
 * No theme flash at launch. The palette lives in the config behind an IPC round-trip, so the first frames used to
 * paint the default dark tokens before a light-theme user's colours arrived. `applyTheme` remembers the last theme
 * in localStorage; `restoreBootTheme` stamps it on <html> synchronously in main.tsx, before React renders, and the
 * hydrated config then merely confirms it. The stored value is validated field by field: it is data we wrote, but a
 * corrupted profile must degrade to the default tokens, never throw before the app boots.
 */
import type { AppConfig } from '@aiwc/protocol'
import { DEFAULT_PALETTES, paletteTokens } from './appearance'

export const BOOT_THEME_KEY = 'aiwc.boot-theme'

export type ResolvedTheme = 'dark' | 'light'
type Theme = AppConfig['general']['theme']
type Appearance = AppConfig['general']['appearance']
type Palette = Appearance['dark']

export interface BootTheme {
  theme: Theme
  appearance?: Appearance
}

const THEMES: readonly Theme[] = ['dark', 'light', 'system']
const HEX = /^#[0-9a-fA-F]{6}$/

/** `system` follows the OS through `prefers-color-scheme`; falls back to dark where media queries are unavailable. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function isPalette(value: unknown): value is Palette {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    ['accent', 'background', 'surface', 'foreground'].every((key) => typeof p[key] === 'string' && HEX.test(p[key])) &&
    typeof p.contrast === 'number' &&
    Number.isInteger(p.contrast) &&
    p.contrast >= 0 &&
    p.contrast <= 100
  )
}

function parseBootTheme(raw: string | null): BootTheme | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const { theme, appearance } = parsed as Record<string, unknown>
  if (!THEMES.includes(theme as Theme)) return undefined
  if (appearance === undefined) return { theme: theme as Theme }
  if (!appearance || typeof appearance !== 'object') return undefined
  const { light, dark } = appearance as Record<string, unknown>
  if (!isPalette(light) || !isPalette(dark)) return undefined
  return { theme: theme as Theme, appearance: { light, dark } }
}

/** Called by `applyTheme` whenever the theme or a palette is applied. Storage failures are silent by design. */
export function rememberBootTheme(theme: BootTheme): void {
  try {
    localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({ theme: theme.theme, appearance: theme.appearance }))
  } catch {
    /* private mode / quota: the next launch simply paints the default tokens first */
  }
}

/**
 * Stamp the remembered theme before the first render. Returns false when nothing valid was stored, in which case
 * the default dark tokens stay until the config hydrates.
 */
export function restoreBootTheme(root: HTMLElement = document.documentElement): boolean {
  let saved: BootTheme | undefined
  try {
    saved = parseBootTheme(localStorage.getItem(BOOT_THEME_KEY))
  } catch {
    return false
  }
  if (!saved) return false
  const mode = resolveTheme(saved.theme)
  root.dataset.theme = mode
  const tokens = paletteTokens(saved.appearance?.[mode] ?? DEFAULT_PALETTES[mode])
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value)
  return true
}
