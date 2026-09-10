import { describe, expect, it, vi } from 'vitest'
import { AppConfigSchema, defaultConfig } from '@aiwc/protocol'
import { applyTheme } from './configStore'
import { contrastRatio, DEFAULT_PALETTES, paletteTokens } from './appearance'

describe('appearance palettes', () => {
  it('migrates old configuration and rejects invalid colors and contrast', () => {
    expect(AppConfigSchema.parse({ general: { theme: 'light' } }).general.appearance).toEqual(DEFAULT_PALETTES)
    const config = defaultConfig()
    config.general.appearance.dark.accent = 'invalid'
    expect(AppConfigSchema.safeParse(config).success).toBe(false)
    config.general.appearance.dark = { ...DEFAULT_PALETTES.dark, contrast: 101 }
    expect(AppConfigSchema.safeParse(config).success).toBe(false)
  })
  it('applies independent palettes and restores them when switching', () => {
    const appearance = { light: { ...DEFAULT_PALETTES.light, accent: '#008800' }, dark: { ...DEFAULT_PALETTES.dark, accent: '#bb88ff' } }
    applyTheme('light', appearance)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#008800')
    applyTheme('dark', appearance)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#bb88ff')
    expect(document.documentElement.style.getPropertyValue('--bg-content')).toBe(DEFAULT_PALETTES.dark.background)
  })
  it('reapplies the matching palette when the system theme changes', () => {
    let change = () => {}
    const media = { matches: true, addEventListener: (_event: string, callback: () => void) => { change = callback }, removeEventListener: () => {} }
    vi.stubGlobal('matchMedia', () => media)
    try {
      applyTheme('system', DEFAULT_PALETTES)
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe(DEFAULT_PALETTES.light.accent)
      media.matches = false
      change()
      expect(document.documentElement.dataset.theme).toBe('dark')
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe(DEFAULT_PALETTES.dark.accent)
    } finally {
      applyTheme('dark', DEFAULT_PALETTES)
      vi.unstubAllGlobals()
    }
  })
  it('chooses readable accent labels and increases text contrast', () => {
    expect(paletteTokens({ ...DEFAULT_PALETTES.light, accent: '#ffffff' })['--fg-on-accent']).toBe('#000000')
    expect(paletteTokens({ ...DEFAULT_PALETTES.dark, accent: '#000000' })['--fg-on-accent']).toBe('#ffffff')
    const low = paletteTokens({ ...DEFAULT_PALETTES.dark, contrast: 0 })
    const high = paletteTokens({ ...DEFAULT_PALETTES.dark, contrast: 100 })
    expect(contrastRatio(high['--fg-3']!, high['--bg-content']!)).toBeGreaterThan(contrastRatio(low['--fg-3']!, low['--bg-content']!))
  })
})
