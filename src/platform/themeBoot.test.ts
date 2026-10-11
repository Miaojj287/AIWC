import { afterEach, describe, expect, it } from 'vitest'
import { BOOT_THEME_KEY, rememberBootTheme, resolveTheme, restoreBootTheme } from './themeBoot'

const palette = {
  light: { accent: '#4e82ef', background: '#fafafa', surface: '#ececec', foreground: '#111111', contrast: 35 },
  dark: { accent: '#4e82ef', background: '#101010', surface: '#2a2a2a', foreground: '#f5f5f5', contrast: 81 },
}

function freshRoot(): HTMLElement {
  const root = document.createElement('div')
  return root
}

afterEach(() => {
  localStorage.removeItem(BOOT_THEME_KEY)
})

describe('boot theme', () => {
  it('stamps the remembered mode and palette before the config arrives', () => {
    rememberBootTheme({ theme: 'light', appearance: palette })
    const root = freshRoot()
    expect(restoreBootTheme(root)).toBe(true)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.getPropertyValue('--bg-content')).toBe('#fafafa')
    expect(root.style.getPropertyValue('--bg-shell')).toBe('#ececec')
    expect(root.style.getPropertyValue('--fg')).toBe('#111111')
  })

  it('falls back to the default palette of the remembered mode when no custom colours were saved', () => {
    rememberBootTheme({ theme: 'dark' })
    const root = freshRoot()
    expect(restoreBootTheme(root)).toBe(true)
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.getPropertyValue('--bg-content')).toBe('#181818')
  })

  it('ignores anything that is not a valid theme record', () => {
    for (const raw of ['{', '"light"', '{"theme":"neon"}', '{"theme":"light","appearance":{"light":{}}}']) {
      localStorage.setItem(BOOT_THEME_KEY, raw)
      const root = freshRoot()
      expect(restoreBootTheme(root)).toBe(false)
      expect(root.dataset.theme).toBeUndefined()
    }
    localStorage.removeItem(BOOT_THEME_KEY)
    expect(restoreBootTheme(freshRoot())).toBe(false)
  })

  it('resolves system to the OS preference and passes explicit modes through', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    expect(['light', 'dark']).toContain(resolveTheme('system'))
  })
})
