/**
 * Pure helpers for the 宠物图库 section: sort options, the install step list, and where the waving
 * frames sit in a codex-pets.net preview strip. Labels are stored as message keys and resolved at render.
 */
import type { EventMap, PetCatalogSort, PetSpriteVersion } from '@aiwc/protocol'
import { t, type MessageKey } from '@/i18n'
import type { ProgressStep } from '@/kit'

export const SORT_OPTIONS: ReadonlyArray<{ value: PetCatalogSort; label: MessageKey; description: MessageKey }> = [
  { value: 'new', label: 'settings.pets.catalog.sort.new', description: 'settings.pets.catalog.sort.newDescription' },
  {
    value: 'popular',
    label: 'settings.pets.catalog.sort.popular',
    description: 'settings.pets.catalog.sort.popularDescription',
  },
  {
    value: 'views',
    label: 'settings.pets.catalog.sort.views',
    description: 'settings.pets.catalog.sort.viewsDescription',
  },
  {
    value: 'discussed',
    label: 'settings.pets.catalog.sort.discussed',
    description: 'settings.pets.catalog.sort.discussedDescription',
  },
  {
    value: 'random',
    label: 'settings.pets.catalog.sort.random',
    description: 'settings.pets.catalog.sort.randomDescription',
  },
]

export const CATALOG_PAGE_SIZE = 30

type StepEvent = EventMap['pet:installStep']

export const INSTALL_STEPS: ReadonlyArray<{ id: StepEvent['step']; label: MessageKey }> = [
  { id: 'download', label: 'settings.pets.install.steps.download' },
  { id: 'verify', label: 'settings.pets.install.steps.verify' },
  { id: 'save', label: 'settings.pets.install.steps.save' },
]

/** Fresh step list for the progress dialog (labels in the current language). */
export const initialInstallSteps = (): ProgressStep[] =>
  INSTALL_STEPS.map((s) => ({ id: s.id, label: t(s.label), status: 'todo' }))

export function applyInstallStep(
  steps: readonly ProgressStep[],
  event: Pick<StepEvent, 'step' | 'status' | 'detail'>,
): ProgressStep[] {
  return steps.map((s) => (s.id === event.step ? { ...s, status: event.status, detail: event.detail } : s))
}

export const installProgress = (steps: readonly ProgressStep[]): number =>
  Math.round((steps.filter((s) => s.status === 'done').length / Math.max(1, steps.length)) * 100)

/** Preview strips hold every frame at half size (96×104) in row order: idle, run right, run left, … */
export const PREVIEW_FRAME = { width: 96, height: 104 } as const
const FRAMES_AFTER_IDLE: Record<PetSpriteVersion, number> = {
  1: 8 + 8 + 4 + 5 + 8 + 6 + 6 + 6,
  2: 8 + 8 + 4 + 5 + 8 + 6 + 6 + 6 + 8 + 8,
}

/**
 * Index of the first waving frame in a strip `stripWidth` px wide. The idle length is derived from the
 * width (some sheets carry an extra neutral idle frame); undefined when the strip is not the expected shape.
 */
export function wavingStripOffset(stripWidth: number, version: PetSpriteVersion): number | undefined {
  const frames = Math.round(stripWidth / PREVIEW_FRAME.width)
  const idle = frames - FRAMES_AFTER_IDLE[version]
  if (idle < 1 || idle > 8) return undefined
  return idle + 8 + 8
}
