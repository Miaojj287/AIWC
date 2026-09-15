import { describe, expect, it, vi } from 'vitest'
import { AppConfigSchema, defaultConfig } from '@aiwc/protocol'
import { applyTheme } from './configStore'
import {
  __resetTransparencyForTests,
  applyTransparency,
  contrastRatio,
  DEFAULT_PALETTES,
  paletteTokens,
  setTransparencySupport,
  transparencySupported,
} from './appearance'

describe('appearance palettes', () => {
  it('migrates old configuration and rejects invalid colors and contrast', () => {
    expect(AppConfigSchema.parse({ general: { theme: 'light' } }).general.appearance).toEqual(DEFAULT_PALETTES)
    expect(DEFAULT_PALETTES).toEqual({
      light: { accent: '#4e82ef', background: '#ffffff', surface: '#e9e9e9', foreground: '#000000', contrast: 35 },
      dark: { accent: '#4e82ef', background: '#181818', surface: '#393939', foreground: '#ffffff', contrast: 81 },
    })
    expect(
      AppConfigSchema.parse({
        general: {
          appearance: {
            light: { accent: '#c45100', background: '#f7f8fa', foreground: '#1a1b22', contrast: 35 },
            dark: { accent: '#ff7a1f', background: '#15161c', foreground: '#e8e9ee', contrast: 35 },
          },
        },
      }).general.appearance,
    ).toEqual(DEFAULT_PALETTES)
    const custom = AppConfigSchema.parse({
      general: {
        appearance: {
          light: { accent: '#008800', background: '#f7f8fa', foreground: '#1a1b22', contrast: 35 },
          dark: { accent: '#ff7a1f', background: '#15161c', foreground: '#e8e9ee', contrast: 35 },
        },
      },
    })
    expect(custom.general.appearance.light.accent).toBe('#008800')
    expect(custom.general.appearance.light.surface).toBe('#e4e5e8')
    expect(custom.general.appearance.dark).toEqual(DEFAULT_PALETTES.dark)
    const config = defaultConfig()
    config.general.appearance.dark.accent = 'invalid'
    expect(AppConfigSchema.safeParse(config).success).toBe(false)
    config.general.appearance.dark = { ...DEFAULT_PALETTES.dark, contrast: 101 }
    expect(AppConfigSchema.safeParse(config).success).toBe(false)
  })
  it('applies independent palettes and restores them when switching', () => {
    const appearance = {
      light: { ...DEFAULT_PALETTES.light, accent: '#008800' },
      dark: { ...DEFAULT_PALETTES.dark, accent: '#bb88ff' },
    }
    applyTheme('light', appearance)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#008800')
    applyTheme('dark', appearance)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#bb88ff')
    expect(document.documentElement.style.getPropertyValue('--bg-content')).toBe(DEFAULT_PALETTES.dark.background)
  })
  it('reapplies the matching palette when the system theme changes', () => {
    let change = () => {}
    const media = {
      matches: true,
      addEventListener: (_event: string, callback: () => void) => {
        change = callback
      },
      removeEventListener: () => {},
    }
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
    expect(paletteTokens(DEFAULT_PALETTES.dark)['--fg-on-accent']).toBe('#ffffff')
    const low = paletteTokens({ ...DEFAULT_PALETTES.dark, contrast: 0 })
    const high = paletteTokens({ ...DEFAULT_PALETTES.dark, contrast: 100 })
    expect(contrastRatio(high['--fg-3']!, high['--bg-content']!)).toBeGreaterThan(
      contrastRatio(low['--fg-3']!, low['--bg-content']!),
    )
    expect(paletteTokens(DEFAULT_PALETTES.dark)).toMatchObject({
      '--bg-content': '#181818',
      '--bg-shell': '#393939',
      '--bg-panel': '#292929',
      '--bg-raised': '#3d3d3d',
      '--bg-overlay': '#2f2f2f',
      '--fg': '#ffffff',
      '--fg-2': '#cdcdcd',
      '--fg-3': '#adadad',
      '--accent': '#4e82ef',
    })
    expect(paletteTokens(DEFAULT_PALETTES.light)).toMatchObject({
      '--bg-content': '#ffffff',
      '--bg-shell': '#e9e9e9',
      '--bg-panel': '#f2f2f2',
      '--bg-raised': '#e4e4e4',
      '--bg-overlay': '#f0f0f0',
      '--fg': '#000000',
      '--fg-2': '#434343',
      '--fg-3': '#6f6f6f',
      '--accent': '#4e82ef',
    })
  })

  it('uses foreground surfaces independently from the font color', () => {
    const tokens = paletteTokens({ ...DEFAULT_PALETTES.dark, surface: '#445566', foreground: '#ffffff' })
    expect(tokens['--bg-shell']).toBe('#445566')
    expect(tokens['--bg-panel']).not.toBe(tokens['--bg-content'])
    expect(tokens['--fg']).toBe('#ffffff')
  })
})

describe('透明效果', () => {
  const html = document.documentElement
  const withBridge = (
    bridge: { runtime: 'electron' | 'web'; platform: 'darwin' | 'win32' | 'linux' } | undefined,
    run: () => void,
  ) => {
    const w = window as unknown as { aiwc?: unknown }
    const previous = w.aiwc
    if (bridge) w.aiwc = bridge
    else delete w.aiwc
    __resetTransparencyForTests()
    try {
      run()
    } finally {
      __resetTransparencyForTests()
      if (previous === undefined) delete w.aiwc
      else w.aiwc = previous
    }
  }

  it('is on for new installs and keeps a value the user saved', () => {
    expect(AppConfigSchema.parse({}).general.transparency).toBe(true)
    expect(defaultConfig().general.transparency).toBe(true)
    expect(AppConfigSchema.parse({ general: { transparency: false } }).general.transparency).toBe(false)
  })

  it('stamps data-glass on macOS desktop and removes it when switched off', () => {
    withBridge({ runtime: 'electron', platform: 'darwin' }, () => {
      applyTransparency(true)
      expect(html.dataset.glass).toBe('true')
      applyTransparency(false)
      expect(html.dataset.glass).toBeUndefined()
    })
  })

  it('never stamps it in the web preview, where no native layer sits behind the page', () => {
    withBridge({ runtime: 'web', platform: 'darwin' }, () => {
      applyTransparency(true)
      expect(transparencySupported()).toBe(false)
      expect(html.dataset.glass).toBeUndefined()
    })
  })

  it('waits for the main process on Windows and re-applies the setting once it answers', () => {
    withBridge({ runtime: 'electron', platform: 'win32' }, () => {
      applyTransparency(true)
      expect(html.dataset.glass).toBeUndefined()
      setTransparencySupport(true)
      expect(html.dataset.glass).toBe('true')
      setTransparencySupport(false)
      expect(html.dataset.glass).toBeUndefined()
    })
  })

  it('applyTheme carries the flag with the palette', () => {
    withBridge({ runtime: 'electron', platform: 'darwin' }, () => {
      applyTheme('dark', DEFAULT_PALETTES, true)
      expect(html.dataset.glass).toBe('true')
      applyTheme('dark', DEFAULT_PALETTES, false)
      expect(html.dataset.glass).toBeUndefined()
    })
  })
})
