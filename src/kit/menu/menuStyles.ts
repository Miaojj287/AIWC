/**
 * One item style shared by DropdownMenu and ContextMenu (CLAUDE.md §3 浮层): overlay ground, r8, p6;
 * item h30 (h42 with description), r6, hover fg 7%, disabled 40%, danger red — always last.
 */
import { cn } from '../cn'

export const menuContentClass = cn(
  'kit-menu z-50 min-w-[180px] max-w-[320px] overflow-hidden rounded-item border border-line-10 bg-overlay p-1.5 text-fg shadow-overlay outline-none',
  'flex flex-col gap-px',
)

export const menuSubContentClass = cn(menuContentClass, 'min-w-[160px]')

export const menuItemClass = (opts: { description?: boolean; danger?: boolean; inset?: boolean }) =>
  cn(
    'relative flex shrink-0 cursor-default select-none items-center gap-2 rounded-control px-2 text-tab text-fg outline-none',
    opts.description ? 'h-[42px]' : 'h-[30px]',
    'data-[highlighted]:bg-hover-7 data-[state=open]:bg-hover-7',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
    opts.danger && 'text-danger data-[highlighted]:text-danger',
    opts.inset && 'pl-8',
  )

export const menuLabelClass = 'px-2 pb-1 pt-1.5 text-micro font-medium text-fg-3'
export const menuSeparatorClass = 'my-1 h-px w-full bg-line-8'
export const menuShortcutClass = 'ml-auto shrink-0 pl-3 font-latin text-micro text-fg-3'
export const menuIconClass = 'shrink-0 text-fg-2'
export const menuIndicatorSlotClass = 'flex size-3.5 shrink-0 items-center justify-center text-accent'
