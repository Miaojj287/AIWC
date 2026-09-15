/**
 * Codex Pets animation table: which sheet row each animation uses and how long each frame shows.
 * Timings mirror the Codex app (codex-rs/tui/src/pets/model.rs): a slow breathing idle, state rows at
 * ~120–150 ms a frame with a longer hold on the last frame. v2 sheets add two "look around" rows.
 */
import {
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  PET_SHEET_COLUMNS,
  PET_SHEET_ROWS,
  type PetSpriteVersion,
} from '@aiwc/protocol'

export type PetAnimationId =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'
  | 'look-right'
  | 'look-left'

export interface PetAnimationSpec {
  row: number
  /** Duration of every frame, left to right. */
  durations: readonly number[]
  /** Oldest sheet version that has this row. */
  minVersion: PetSpriteVersion
}

const row = (
  index: number,
  frames: number,
  frameMs: number,
  lastMs: number,
  minVersion: PetSpriteVersion = 1,
): PetAnimationSpec => ({
  row: index,
  durations: Array.from({ length: frames }, (_, i) => (i === frames - 1 ? lastMs : frameMs)),
  minVersion,
})

export const PET_ANIMATIONS: Record<PetAnimationId, PetAnimationSpec> = {
  idle: { row: 0, durations: [1680, 660, 660, 840, 840, 1920], minVersion: 1 },
  'running-right': row(1, 8, 120, 220),
  'running-left': row(2, 8, 120, 220),
  waving: row(3, 4, 140, 280),
  jumping: row(4, 5, 140, 280),
  failed: row(5, 8, 140, 240),
  waiting: row(6, 6, 150, 260),
  running: row(7, 6, 120, 220),
  review: row(8, 6, 150, 280),
  'look-right': row(9, 8, 160, 320, 2),
  'look-left': row(10, 8, 160, 320, 2),
}

/** The animation to actually play: rows a v1 sheet does not have fall back to idle. */
export function animationFor(id: PetAnimationId, version: PetSpriteVersion): PetAnimationId {
  return PET_ANIMATIONS[id].minVersion <= version ? id : 'idle'
}

export function cycleDuration(id: PetAnimationId): number {
  return PET_ANIMATIONS[id].durations.reduce((sum, ms) => sum + ms, 0)
}

/** Background offset (unscaled px) of one frame. */
export function frameOffset(id: PetAnimationId, frame: number): { x: number; y: number } {
  const spec = PET_ANIMATIONS[id]
  const column = Math.max(0, Math.min(spec.durations.length - 1, frame)) % PET_SHEET_COLUMNS
  return { x: -column * PET_FRAME_WIDTH, y: -spec.row * PET_FRAME_HEIGHT }
}

export function sheetSize(version: PetSpriteVersion): { width: number; height: number } {
  return { width: PET_SHEET_COLUMNS * PET_FRAME_WIDTH, height: PET_SHEET_ROWS[version] * PET_FRAME_HEIGHT }
}

/** Flair moves for an idle pet: a wave or a hop, plus looking around on v2 sheets. */
export function flairPool(version: PetSpriteVersion): PetAnimationId[] {
  return version >= 2 ? ['waving', 'jumping', 'look-right', 'look-left'] : ['waving', 'jumping']
}

export type PetSize = 'sm' | 'md' | 'lg'

/** Sprite scale per size setting (frame 192×208 → ~50 / 65 / 84 px wide). */
export const PET_SCALE: Record<PetSize, number> = { sm: 0.26, md: 0.34, lg: 0.44 }

export const scaledFrame = (scale: number): { width: number; height: number } => ({
  width: Math.round(PET_FRAME_WIDTH * scale),
  height: Math.round(PET_FRAME_HEIGHT * scale),
})
