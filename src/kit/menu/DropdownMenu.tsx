import { Check } from 'lucide-react'
import { DropdownMenu as Radix } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import { cn } from '../cn'
import type { IconComponent } from '../icon'
import { MenuItemContent } from './MenuItemBody'
import type { MenuSpec } from './menuSpec'
import { menuContentClass, menuIndicatorSlotClass, menuItemClass, menuLabelClass, menuSeparatorClass, menuSubContentClass } from './menuStyles'

/**
 * DropdownMenu — the `···` / toolbar menu. Same item style as ContextMenu.
 * Group labels, shortcuts on the right, submenus, disabled, badge, danger item (red, last).
 */
export const DropdownMenu = Radix.Root
export const DropdownMenuTrigger = Radix.Trigger
export const DropdownMenuGroup = Radix.Group
export const DropdownMenuSub = Radix.Sub
export const DropdownMenuRadioGroup = Radix.RadioGroup

export const DropdownMenuContent = forwardRef<ElementRef<typeof Radix.Content>, ComponentPropsWithoutRef<typeof Radix.Content>>(
  function DropdownMenuContent({ className, sideOffset = 4, align = 'end', collisionPadding = 8, ...rest }, ref) {
    return (
      <Radix.Portal>
        <Radix.Content ref={ref} sideOffset={sideOffset} align={align} collisionPadding={collisionPadding} className={cn(menuContentClass, className)} {...rest} />
      </Radix.Portal>
    )
  },
)

export const DropdownMenuSubContent = forwardRef<ElementRef<typeof Radix.SubContent>, ComponentPropsWithoutRef<typeof Radix.SubContent>>(
  function DropdownMenuSubContent({ className, sideOffset = 6, alignOffset = -6, ...rest }, ref) {
    return (
      <Radix.Portal>
        <Radix.SubContent ref={ref} sideOffset={sideOffset} alignOffset={alignOffset} className={cn(menuSubContentClass, className)} {...rest} />
      </Radix.Portal>
    )
  },
)

export interface DropdownMenuItemProps extends Omit<ComponentPropsWithoutRef<typeof Radix.Item>, 'children'> {
  icon?: IconComponent
  children: ReactNode
  description?: ReactNode
  shortcut?: string
  badge?: ReactNode
  /** Red text; put it last, after a separator. */
  danger?: boolean
}

export const DropdownMenuItem = forwardRef<ElementRef<typeof Radix.Item>, DropdownMenuItemProps>(function DropdownMenuItem(
  { icon, children, description, shortcut, badge, danger, className, ...rest },
  ref,
) {
  return (
    <Radix.Item ref={ref} data-danger={danger || undefined} className={cn(menuItemClass({ description: Boolean(description), danger }), className)} {...rest}>
      <MenuItemContent icon={icon} label={children} description={description} shortcut={shortcut} badge={badge} danger={danger} />
    </Radix.Item>
  )
})

export interface DropdownMenuSubTriggerProps extends Omit<ComponentPropsWithoutRef<typeof Radix.SubTrigger>, 'children'> {
  icon?: IconComponent
  children: ReactNode
}

export const DropdownMenuSubTrigger = forwardRef<ElementRef<typeof Radix.SubTrigger>, DropdownMenuSubTriggerProps>(function DropdownMenuSubTrigger(
  { icon, children, className, ...rest },
  ref,
) {
  return (
    <Radix.SubTrigger ref={ref} className={cn(menuItemClass({}), className)} {...rest}>
      <MenuItemContent icon={icon} label={children} submenu />
    </Radix.SubTrigger>
  )
})

export interface DropdownMenuCheckboxItemProps extends Omit<ComponentPropsWithoutRef<typeof Radix.CheckboxItem>, 'children'> {
  icon?: IconComponent
  children: ReactNode
  description?: ReactNode
}

export const DropdownMenuCheckboxItem = forwardRef<ElementRef<typeof Radix.CheckboxItem>, DropdownMenuCheckboxItemProps>(
  function DropdownMenuCheckboxItem({ icon, children, description, className, ...rest }, ref) {
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

export interface DropdownMenuRadioItemProps extends Omit<ComponentPropsWithoutRef<typeof Radix.RadioItem>, 'children'> {
  children: ReactNode
  description?: ReactNode
}

export const DropdownMenuRadioItem = forwardRef<ElementRef<typeof Radix.RadioItem>, DropdownMenuRadioItemProps>(function DropdownMenuRadioItem(
  { children, description, className, ...rest },
  ref,
) {
  return (
    <Radix.RadioItem ref={ref} className={cn(menuItemClass({ description: Boolean(description) }), className)} {...rest}>
      <span className={menuIndicatorSlotClass}>
        <Radix.ItemIndicator>
          <Check size={12} strokeWidth={2} aria-hidden />
        </Radix.ItemIndicator>
      </span>
      <MenuItemContent label={children} description={description} />
    </Radix.RadioItem>
  )
})

export const DropdownMenuLabel = forwardRef<ElementRef<typeof Radix.Label>, ComponentPropsWithoutRef<typeof Radix.Label>>(function DropdownMenuLabel(
  { className, ...rest },
  ref,
) {
  return <Radix.Label ref={ref} className={cn(menuLabelClass, className)} {...rest} />
})

export const DropdownMenuSeparator = forwardRef<ElementRef<typeof Radix.Separator>, ComponentPropsWithoutRef<typeof Radix.Separator>>(
  function DropdownMenuSeparator({ className, ...rest }, ref) {
    return <Radix.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...rest} />
  },
)

/** Render a MenuSpec inside a DropdownMenuContent. */
export function DropdownMenuItems({ items }: { items: MenuSpec }) {
  return (
    <>
      {items.map((it, i) => {
        switch (it.type) {
          case 'separator':
            return <DropdownMenuSeparator key={it.id ?? `sep-${i}`} />
          case 'label':
            return <DropdownMenuLabel key={it.id}>{it.label}</DropdownMenuLabel>
          case 'checkbox':
            return (
              <DropdownMenuCheckboxItem key={it.id} icon={it.icon} description={it.description} checked={it.checked} disabled={it.disabled} onCheckedChange={it.onCheckedChange}>
                {it.label}
              </DropdownMenuCheckboxItem>
            )
          case 'sub':
            return (
              <DropdownMenuSub key={it.id}>
                <DropdownMenuSubTrigger icon={it.icon} disabled={it.disabled}>
                  {it.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItems items={it.items} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          default:
            return (
              <DropdownMenuItem key={it.id} icon={it.icon} description={it.description} shortcut={it.shortcut} badge={it.badge} danger={it.danger} disabled={it.disabled} onSelect={it.onSelect}>
                {it.label}
              </DropdownMenuItem>
            )
        }
      })}
    </>
  )
}
