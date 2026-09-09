/**
 * Icon conventions (CLAUDE.md §7): lucide line icons only, stroke 1.75, sizes are fixed per slot.
 * Components import lucide icons directly; this file just centralises the constants and the
 * `IconComponent` type used for icon props so callers pass the component, not an element.
 */
import type { LucideIcon, LucideProps } from 'lucide-react'

export type IconComponent = LucideIcon

export const ICON_STROKE = 1.75

/** Fixed icon sizes per slot, mirroring the Figma component board. */
export const ICON_SIZE = {
  button: 13,
  iconButton: 15,
  input: 13,
  inputTrailing: 14,
  menu: 14,
  menuAux: 12,
  tab: 14,
  toast: 14,
  inline: 12,
  dialog: 18,
  emptyState: 22,
  chip: 12,
} as const

export const iconProps = (size: number): Pick<LucideProps, 'size' | 'strokeWidth' | 'aria-hidden'> => ({
  size,
  strokeWidth: ICON_STROKE,
  'aria-hidden': true,
})
