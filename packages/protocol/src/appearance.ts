import type { AppConfig } from './config'

type AppearancePalette = AppConfig['general']['appearance']['dark']

/** Blend two validated six-digit palette colours using the same rounding on every surface. */
export function mixPaletteColors(first: string, second: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) =>
    Math.round(
      parseInt(first.slice(offset, offset + 2), 16) * (1 - amount) +
        parseInt(second.slice(offset, offset + 2), 16) * amount,
    ),
  )
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** Shared frame/panel ground for the renderer and native caption buttons. */
export function panelBackgroundFor(palette: Pick<AppearancePalette, 'background' | 'surface' | 'contrast'>): string {
  return mixPaletteColors(palette.background, palette.surface, 0.65 - (palette.contrast / 100) * 0.167)
}
