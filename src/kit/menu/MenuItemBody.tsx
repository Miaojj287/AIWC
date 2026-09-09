import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from '../icon'
import { menuIconClass, menuShortcutClass } from './menuStyles'

export interface MenuItemContentProps {
  icon?: IconComponent
  label: ReactNode
  description?: ReactNode
  shortcut?: string
  badge?: ReactNode
  /** Draw the ▸ submenu chevron on the right. */
  submenu?: boolean
  danger?: boolean
}

/** Shared inner layout for dropdown / context / sub-trigger items: icon 14 | label (+description) | shortcut / badge / ▸. */
export function MenuItemContent({ icon: Icon, label, description, shortcut, badge, submenu, danger }: MenuItemContentProps) {
  return (
    <>
      {Icon ? <Icon size={ICON_SIZE.menu} strokeWidth={ICON_STROKE} aria-hidden className={cn(menuIconClass, danger && 'text-danger')} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate leading-4">{label}</span>
        {description ? <span className="truncate text-micro leading-4 text-fg-3">{description}</span> : null}
      </span>
      {badge ? <span className="ml-auto shrink-0 pl-2">{badge}</span> : null}
      {shortcut ? <span className={menuShortcutClass}>{shortcut}</span> : null}
      {submenu ? <ChevronRight size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden className="ml-auto shrink-0 text-fg-3" /> : null}
    </>
  )
}
