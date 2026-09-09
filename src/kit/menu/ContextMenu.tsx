import { Check } from 'lucide-react'
import { ContextMenu as Radix } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import { cn } from '../cn'
import type { IconComponent } from '../icon'
import { MenuItemContent } from './MenuItemBody'
import type { MenuSpec } from './menuSpec'
import { menuContentClass, menuIndicatorSlotClass, menuItemClass, menuLabelClass, menuSeparatorClass, menuSubContentClass } from './menuStyles'

/**
 * ContextMenu — right-click menu for list items, tabs and messages (CLAUDE.md §4.2).
 * Identical item style to DropdownMenu; feed both the same MenuSpec.
 */
export const ContextMenu = Radix.Root
export const ContextMenuTrigger = Radix.Trigger
export const ContextMenuGroup = Radix.Group
export const ContextMenuSub = Radix.Sub
export const ContextMenuRadioGroup = Radix.RadioGroup

export const ContextMenuContent = forwardRef<ElementRef<typeof Radix.Content>, ComponentPropsWithoutRef<typeof Radix.Content>>(
  function ContextMenuContent({ className, collisionPadding = 8, ...rest }, ref) {
    return (
      <Radix.Portal>
        <Radix.Content ref={ref} collisionPadding={collisionPadding} className={cn(menuContentClass, className)} {...rest} />
      </Radix.Portal>
    )
  },
)

export const ContextMenuSubContent = forwardRef<ElementRef<typeof Radix.SubContent>, ComponentPropsWithoutRef<typeof Radix.SubContent>>(
  function ContextMenuSubContent({ className, sideOffset = 6, alignOffset = -6, ...rest }, ref) {
    return (
      <Radix.Portal>
        <Radix.SubContent ref={ref} sideOffset={sideOffset} alignOffset={alignOffset} className={cn(menuSubContentClass, className)} {...rest} />
      </Radix.Portal>
    )
  },
)

export interface ContextMenuItemProps extends Omit<ComponentPropsWithoutRef<typeof Radix.Item>, 'children'> {
  icon?: IconComponent
  children: ReactNode
  description?: ReactNode
  shortcut?: string
  badge?: ReactNode
  danger?: boolean
}

export const ContextMenuItem = forwardRef<ElementRef<typeof Radix.Item>, ContextMenuItemProps>(function ContextMenuItem(
  { icon, children, description, shortcut, badge, danger, className, ...rest },
  ref,
) {
  return (
    <Radix.Item ref={ref} data-danger={danger || undefined} className={cn(menuItemClass({ description: Boolean(description), danger }), className)} {...rest}>
      <MenuItemContent icon={icon} label={children} description={description} shortcut={shortcut} badge={badge} danger={danger} />
    </Radix.Item>
  )
})

export interface ContextMenuSubTriggerProps extends Omit<ComponentPropsWithoutRef<typeof Radix.SubTrigger>, 'children'> {
  icon?: IconComponent
  children: ReactNode
}

export const ContextMenuSubTrigger = forwardRef<ElementRef<typeof Radix.SubTrigger>, ContextMenuSubTriggerProps>(function ContextMenuSubTrigger(
  { icon, children, className, ...rest },
  ref,
) {
  return (
    <Radix.SubTrigger ref={ref} className={cn(menuItemClass({}), className)} {...rest}>
      <MenuItemContent icon={icon} label={children} submenu />
    </Radix.SubTrigger>
  )
})

export interface ContextMenuCheckboxItemProps extends Omit<ComponentPropsWithoutRef<typeof Radix.CheckboxItem>, 'children'> {
  icon?: IconComponent
  children: ReactNode
  description?: ReactNode
}

export const ContextMenuCheckboxItem = forwardRef<ElementRef<typeof Radix.CheckboxItem>, ContextMenuCheckboxItemProps>(
  function ContextMenuCheckboxItem({ icon, children, description, className, ...rest }, ref) {
    return (
      <Radix.CheckboxItem ref={ref} className={cn(menuItemClass({ description: Boolean(description) }), className)} {...rest}>
        <span className={menuIndicatorSlotClass}>
          <Radix.ItemIndicator>
            <Check size={12} strokeWidth={2} aria-hidden />
          </Radix.ItemIndicator>
        </span>
        <MenuItemContent icon={icon} label={children} description={description} />
      </Radix.CheckboxItem>
    )
  },
)

export const ContextMenuLabel = forwardRef<ElementRef<typeof Radix.Label>, ComponentPropsWithoutRef<typeof Radix.Label>>(function ContextMenuLabel(
  { className, ...rest },
  ref,
) {
  return <Radix.Label ref={ref} className={cn(menuLabelClass, className)} {...rest} />
})

export const ContextMenuSeparator = forwardRef<ElementRef<typeof Radix.Separator>, ComponentPropsWithoutRef<typeof Radix.Separator>>(
  function ContextMenuSeparator({ className, ...rest }, ref) {
    return <Radix.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...rest} />
  },
)

/** Render a MenuSpec inside a ContextMenuContent. */
export function ContextMenuItems({ items }: { items: MenuSpec }) {
  return (
    <>
      {items.map((it, i) => {
        switch (it.type) {
          case 'separator':
            return <ContextMenuSeparator key={it.id ?? `sep-${i}`} />
          case 'label':
            return <ContextMenuLabel key={it.id}>{it.label}</ContextMenuLabel>
          case 'checkbox':
            return (
              <ContextMenuCheckboxItem key={it.id} icon={it.icon} description={it.description} checked={it.checked} disabled={it.disabled} onCheckedChange={it.onCheckedChange}>
                {it.label}
              </ContextMenuCheckboxItem>
            )
          case 'sub':
            return (
              <ContextMenuSub key={it.id}>
                <ContextMenuSubTrigger icon={it.icon} disabled={it.disabled}>
                  {it.label}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItems items={it.items} />
                </ContextMenuSubContent>
              </ContextMenuSub>
            )
          default:
            return (
              <ContextMenuItem key={it.id} icon={it.icon} description={it.description} shortcut={it.shortcut} badge={it.badge} danger={it.danger} disabled={it.disabled} onSelect={it.onSelect}>
                {it.label}
              </ContextMenuItem>
            )
        }
      })}
    </>
  )
}
