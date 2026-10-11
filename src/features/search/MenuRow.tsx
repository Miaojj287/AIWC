/**
 * A kit ListItem whose secondary actions live in one MenuSpec, shown both by the hover `···` and by right-click
 * (CLAUDE.md §4.1–4.2). The row keeps its hover look while the `···` menu is open.
 */
import { Ellipsis } from 'lucide-react'
import { useState } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  ListItem,
  type ListItemProps,
  type MenuSpec,
} from '@/kit'

export interface MenuRowProps extends Omit<ListItemProps, 'hoverActions'> {
  menu: MenuSpec
  /** Accessible name of the `···` button. */
  moreLabel: string
}

export function MenuRow({ menu, moreLabel, ...item }: MenuRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          {...item}
          data-hover={menuOpen || undefined}
          hoverActions={
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <IconButton icon={Ellipsis} label={moreLabel} size="sm" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItems items={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
