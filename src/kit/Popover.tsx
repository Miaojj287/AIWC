import { Popover as RadixPopover } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { cn } from './cn'

/**
 * Popover — light-weight confirmation / small form anchored to its trigger (DESIGN-SPEC §6).
 * Overlay ground, r12, overlay shadow (Figma 会话信息 / 权限确认 popovers).
 */
export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger
export const PopoverAnchor = RadixPopover.Anchor
export const PopoverClose = RadixPopover.Close

export type PopoverContentProps = ComponentPropsWithoutRef<typeof RadixPopover.Content>

export const PopoverContent = forwardRef<ElementRef<typeof RadixPopover.Content>, PopoverContentProps>(function PopoverContent(
  { className, sideOffset = 6, align = 'start', collisionPadding = 8, children, ...rest },
  ref,
) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        className={cn(
          'kit-menu z-50 w-[280px] rounded-card border border-line-10 bg-overlay p-3 text-body text-fg shadow-overlay outline-none',
          className,
        )}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
})
