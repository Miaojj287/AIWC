import { DEFAULT_APPEARANCE, type AppConfig } from '@aiwc/protocol'

type Palette = AppConfig['general']['appearance']['dark']
export const DEFAULT_PALETTES: Record<'light' | 'dark', Palette> = {
  light: { ...DEFAULT_APPEARANCE.light },
  dark: { ...DEFAULT_APPEARANCE.dark },
}
const mix = (a: string, b: string, amount: number) => {
  const rgb = [1, 3, 5].map((i) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount),
  )
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0)
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export function paletteTokens(p: Palette): Record<string, string> {
  const { background: bg, surface, foreground: fg, accent, contrast } = p
  const strength = contrast / 100
  const out: Record<string, string> = {
    '--bg-content': bg,
    '--bg-shell': surface,
    '--bg-panel': mix(bg, surface, 0.65 - strength * 0.167),
    '--bg-raised': mix(surface, fg, 0.02),
    '--bg-overlay': mix(bg, surface, 0.7),
    '--fg': fg,
    '--fg-2': mix(bg, fg, 0.704 + strength * 0.1),
    '--fg-3': mix(bg, fg, 0.5 + strength * 0.18),
    '--accent': accent,
    '--accent-hover': mix(accent, fg, 0.12),
    '--accent-active': mix(accent, bg, 0.12),
    '--fg-on-accent': contrastRatio(accent, '#ffffff') >= 3 ? '#ffffff' : '#000000',
  }
  for (const n of [12, 15, 30]) out[`--accent-${n}`] = `color-mix(in srgb, ${accent} ${n}%, transparent)`
  for (const n of [4, 6, 8, 10, 16, 25])
    out[`--line-${n}`] = `color-mix(in srgb, ${fg} ${n * (0.65 + strength)}%, transparent)`
  for (const n of [5, 7]) out[`--hover-${n}`] = `color-mix(in srgb, ${fg} ${n}%, transparent)`
  return out
}
export function applyPalette(mode: 'light' | 'dark', appearance?: AppConfig['general']['appearance']) {
  const tokens = paletteTokens(appearance?.[mode] ?? DEFAULT_PALETTES[mode])
  for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value)
}

/** What the main process reported via app:getInfo; undefined until the startup handshake answers. */
let nativeTransparency: boolean | undefined
/** The user's 透明效果 setting, kept so a late support answer can re-apply it. */
let wantTransparency = false

/**
 * True where the window can blur the desktop behind it. Only the desktop app can; until the main process answers,
 * macOS is assumed capable (every supported version is) and Windows is not (acrylic needs Windows 11 22H2+).
 */
export function transparencySupported(): boolean {
  const b = typeof window === 'undefined' ? undefined : window.aiwc
  if (b?.runtime !== 'electron') return false
  return nativeTransparency ?? b.platform === 'darwin'
}

/** Startup handshake result (src/main.tsx). */
export function setTransparencySupport(supported: boolean): void {
  nativeTransparency = supported
  applyTransparency(wantTransparency)
}

/**
 * 透明效果: stamp <html data-glass> so shell.css turns the rail and the object list into tinted glass over the native
 * vibrancy / acrylic layer. Never stamped where no such layer exists, or the columns would show a bare window.
 */
export function applyTransparency(enabled: boolean | undefined): void {
  wantTransparency = Boolean(enabled)
  if (typeof document === 'undefined') return
  if (wantTransparency && transparencySupported()) document.documentElement.dataset.glass = 'true'
  else delete document.documentElement.dataset.glass
}

/** Reset module state (tests). */
export function __resetTransparencyForTests(): void {
  nativeTransparency = undefined
  wantTransparency = false
  if (typeof document !== 'undefined') delete document.documentElement.dataset.glass
}
