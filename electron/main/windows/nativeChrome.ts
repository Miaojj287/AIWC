/**
 * Native window chrome colours: the Windows caption buttons (titleBarOverlay) and the page base painted before the
 * renderer's first frame. Both share the renderer's derived frame colour and palette foreground,
 * so a light-theme user never gets dark caption buttons or a dark flash at launch. Pure helpers; the window-facing
 * part takes a narrow target so it is unit-tested without Electron.
 */
import { DEFAULT_APPEARANCE, panelBackgroundFor, type AppConfig } from '@aiwc/protocol'

export type ChromeMode = 'light' | 'dark'

export interface NativeChromeColors {
  /** The frame ground (`--bg-panel`): window base and caption-button background. */
  background: string
  /** The palette foreground (`--fg`): caption-button symbols. */
  foreground: string
}

export interface TitleBarOverlayColors {
  color: string
  symbolColor: string
  height: number
}

/** `theme: 'system'` follows the OS; callers pass `nativeTheme.shouldUseDarkColors`. */
export function resolveChromeMode(theme: AppConfig['general']['theme'], systemDark: boolean): ChromeMode {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

/** The colours of the continuous window frame, shared with the renderer's `paletteTokens`. */
export function nativeChromeColors(
  general: Pick<AppConfig['general'], 'theme' | 'appearance'>,
  systemDark: boolean,
): NativeChromeColors {
  const mode = resolveChromeMode(general.theme, systemDark)
  const palette = general.appearance?.[mode] ?? DEFAULT_APPEARANCE[mode]
  return { background: panelBackgroundFor(palette), foreground: palette.foreground }
}

/** Windows caption buttons sit in the full-width title row: same ground, same symbol colour. */
export function titleBarOverlayFor(colors: NativeChromeColors, height: number): TitleBarOverlayColors {
  return { color: colors.background, symbolColor: colors.foreground, height }
}

export interface NativeChromeTarget {
  setBackgroundColor(color: string): void
  setTitleBarOverlay?(options: TitleBarOverlayColors): void
}

export interface ApplyNativeChromeOptions {
  /** 透明效果 is on and the OS can blur: the page base must stay transparent. */
  transparent: boolean
  overlayHeight: number
}

/** Runtime re-apply after a theme / palette change. Only Windows has caption buttons to recolour. */
export function applyNativeChrome(
  win: NativeChromeTarget,
  platform: NodeJS.Platform,
  colors: NativeChromeColors,
  options: ApplyNativeChromeOptions,
): void {
  if (platform === 'win32') win.setTitleBarOverlay?.(titleBarOverlayFor(colors, options.overlayHeight))
  if (!options.transparent) win.setBackgroundColor(colors.background)
}
