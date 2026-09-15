/**
 * 透明效果 (设置 › 常规 › 外观 › 透明效果): the native material behind the rail and the object list. Pure helpers —
 * only Electron *types* are imported — so the platform gate and the option shapes are unit-tested without a window.
 * The renderer paints those two columns as tinted glass (src/shell/shell.css `data-glass`) and learns whether this OS
 * can blur at all from `app:getInfo().transparency`.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { DEFAULT_APPEARANCE } from '@aiwc/protocol'

/** The opaque base colour the window uses whenever the effect is off (matches the renderer's first paint). */
export const OPAQUE_BACKGROUND = DEFAULT_APPEARANCE.dark.background
/** Fully transparent page base: lets the native vibrancy / acrylic layer show wherever the renderer paints nothing. */
export const TRANSPARENT_BACKGROUND = '#00000000'
/** macOS material behind the sidebar columns (the Finder / Codex sidebar one); it follows nativeTheme light / dark. */
export const VIBRANCY_MATERIAL = 'sidebar'
/** Windows 11 22H2 (build 22621) is the first release with the acrylic background material. */
export const WINDOWS_ACRYLIC_MIN_BUILD = 22621

/** Whether this OS can blur what is behind the window: every macOS we ship on, Windows 11 22H2+, never Linux. */
export function supportsTransparency(platform: NodeJS.Platform, systemVersion?: string): boolean {
  if (platform === 'darwin') return true
  if (platform === 'win32') return Number(systemVersion?.split('.')[2] ?? 0) >= WINDOWS_ACRYLIC_MIN_BUILD
  return false
}

/**
 * Constructor options. The macOS effect state is pinned to `active` even while the effect is off: Electron reads it
 * once at construction, so a runtime `setVibrancy` keeps the glass lit when the window loses focus instead of
 * flattening to grey.
 */
export function transparencyOptionsFor(
  platform: NodeJS.Platform,
  enabled: boolean,
  systemVersion?: string,
): BrowserWindowConstructorOptions {
  if (platform !== 'darwin' && platform !== 'win32') return {}
  const base: BrowserWindowConstructorOptions = platform === 'darwin' ? { visualEffectState: 'active' } : {}
  if (!enabled || !supportsTransparency(platform, systemVersion)) return base
  if (platform === 'darwin') return { ...base, vibrancy: VIBRANCY_MATERIAL, backgroundColor: TRANSPARENT_BACKGROUND }
  return { ...base, backgroundMaterial: 'acrylic', backgroundColor: TRANSPARENT_BACKGROUND }
}

export type TransparencyTarget = Pick<BrowserWindow, 'setVibrancy' | 'setBackgroundMaterial' | 'setBackgroundColor'>

/** Runtime toggle from the settings row: swaps the material in place, the window is never recreated. */
export function applyTransparency(
  win: TransparencyTarget,
  platform: NodeJS.Platform,
  enabled: boolean,
  systemVersion?: string,
): void {
  if (!supportsTransparency(platform, systemVersion)) return
  if (platform === 'darwin') win.setVibrancy(enabled ? VIBRANCY_MATERIAL : null)
  else win.setBackgroundMaterial(enabled ? 'acrylic' : 'none')
  win.setBackgroundColor(enabled ? TRANSPARENT_BACKGROUND : OPAQUE_BACKGROUND)
}

/** `process.getSystemVersion()` exists only inside Electron; tests and plain Node get undefined. */
export function currentSystemVersion(): string | undefined {
  const proc = process as NodeJS.Process & { getSystemVersion?: () => string }
  return typeof proc.getSystemVersion === 'function' ? proc.getSystemVersion() : undefined
}
