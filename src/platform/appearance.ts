import type { AppConfig } from '@aiwc/protocol'

type Palette = AppConfig['general']['appearance']['dark']
export const DEFAULT_PALETTES: Record<'light' | 'dark', Palette> = {
  light: { accent: '#c45100', background: '#f7f8fa', foreground: '#1a1b22', contrast: 35 },
  dark: { accent: '#ff7a1f', background: '#15161c', foreground: '#e8e9ee', contrast: 35 },
}
const mix = (a: string, b: string, amount: number) => {
  const rgb = [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount))
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * ([.2126, .7152, .0722][i] ?? 0), 0)
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
export function paletteTokens(p: Palette): Record<string, string> {
  const { background: bg, foreground: fg, accent, contrast } = p
  const strength = contrast / 100
  const out: Record<string, string> = {
    '--bg-content': bg, '--bg-shell': mix(bg, fg, .025 + strength * .04),
    '--bg-panel': mix(bg, fg, .035 + strength * .05), '--bg-raised': mix(bg, fg, .08 + strength * .10), '--bg-overlay': mix(bg, fg, .05 + strength * .06),
    '--fg': fg, '--fg-2': mix(bg, fg, .65 + strength * .25), '--fg-3': mix(bg, fg, .50 + strength * .35),
    '--accent': accent, '--accent-hover': mix(accent, fg, .12), '--accent-active': mix(accent, bg, .12),
    '--fg-on-accent': contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#000000') ? '#ffffff' : '#000000',
  }
  for (const n of [12, 15, 30]) out[`--accent-${n}`] = `color-mix(in srgb, ${accent} ${n}%, transparent)`
  for (const n of [4, 6, 8, 10, 16, 25]) out[`--line-${n}`] = `color-mix(in srgb, ${fg} ${n * (.65 + strength)}%, transparent)`
  for (const n of [5, 7]) out[`--hover-${n}`] = `color-mix(in srgb, ${fg} ${n}%, transparent)`
  return out
}
export function applyPalette(mode: 'light' | 'dark', appearance?: AppConfig['general']['appearance']) {
  const tokens = paletteTokens(appearance?.[mode] ?? DEFAULT_PALETTES[mode])
  for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value)
}
