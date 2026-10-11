/**
 * Zoom / pan arithmetic for the kit ZoomPan viewer (images, diagrams). The view is `translate(x, y) scale(scale)`
 * with the transform origin at the content's top-left; zooming keeps the point under the cursor (or the centre)
 * where it is. Pure — tested in zoomMath.test.ts.
 */
export interface ZoomPanState {
  scale: number
  x: number
  y: number
}

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 8
/** One step of the toolbar buttons and the + / − keys. */
export const ZOOM_STEP = 1.25

export const ZOOM_IDENTITY: ZoomPanState = { scale: 1, x: 0, y: 0 }

export const clampScale = (scale: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))

/** Zoom by `factor` around `point` (in the viewport's coordinates): that point stays put. */
export function zoomAt(state: ZoomPanState, factor: number, point: { x: number; y: number }): ZoomPanState {
  const scale = clampScale(state.scale * factor)
  if (scale === state.scale) return state
  const ratio = scale / state.scale
  return { scale, x: point.x - (point.x - state.x) * ratio, y: point.y - (point.y - state.y) * ratio }
}

/** A wheel delta as a zoom factor; trackpad pinches (ctrl + wheel) arrive as small deltas and get more weight. */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.0015))
}

export function panBy(state: ZoomPanState, dx: number, dy: number): ZoomPanState {
  return { ...state, x: state.x + dx, y: state.y + dy }
}

/** The zoom level as a whole percentage, for the toolbar. */
export const zoomPercent = (state: ZoomPanState): number => Math.round(state.scale * 100)
