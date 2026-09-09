import type { ReactNode } from 'react'
import type { IconComponent } from '../icon'

/**
 * Data-driven menu description so the same list drives a `···` DropdownMenu and the right-click
 * ContextMenu of the same object (CLAUDE.md §4.1–4.2). Order convention: regular actions →
 * separator → cross-feature actions → separator → danger (red, last).
 */
export type MenuSpecItem =
  | {
      type?: 'item'
      id: string
      label: ReactNode
      icon?: IconComponent
      description?: ReactNode
      shortcut?: string
      badge?: ReactNode
      danger?: boolean
      disabled?: boolean
      onSelect?: () => void
    }
  | { type: 'separator'; id?: string }
  | { type: 'label'; id: string; label: ReactNode }
  | {
      type: 'checkbox'
      id: string
      label: ReactNode
      icon?: IconComponent
      description?: ReactNode
      checked: boolean
      disabled?: boolean
      onCheckedChange: (checked: boolean) => void
    }
  | {
      type: 'sub'
      id: string
      label: ReactNode
      icon?: IconComponent
      disabled?: boolean
      items: MenuSpecItem[]
    }

export type MenuSpec = MenuSpecItem[]
