import { forwardRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'

export interface ListItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onSelect'> {
  /** 36px Avatar (or any 36 box). */
  leading?: ReactNode
  /** 13 Medium, truncated. */
  title: ReactNode
  /** Second line, 12 weak, truncated. Pass a fragment to mix a Badge in. */
  subtitle?: ReactNode
  /** Top-right small text (time). Hidden while hover actions are shown. */
  meta?: ReactNode
  /** Bottom-right slot that is always visible: unread Badge, Toggle, status pill. */
  trailing?: ReactNode
  /**
   * Revealed on hover / focus-within: the `···` IconButton with its DropdownMenu.
   * With no `trailing` it overlays the top-right corner (and hides `meta`); with a `trailing`
   * control it sits *next to* it in the right cluster so the two can never overlap.
   */
  hoverActions?: ReactNode
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
  /** Dense = 44px rows (settings lists); default 56px (sessions / contacts). */
  dense?: boolean
}

/**
 * ListItem — the one row for sessions, contacts and rules (CLAUDE.md §3):
 * avatar 36 r8 | title 13 Medium + subtitle 12 weak | meta / badge / toggle on the right.
 * selected = accent 12% ground; hover = fg 5% and reveals `···`. Right-click → the same menu (wrap in ContextMenuTrigger).
 * `data-hover` forces the hover look (gallery / screenshots).
 */
export const ListItem = forwardRef<HTMLDivElement, ListItemProps>(function ListItem(
  { leading, title, subtitle, meta, trailing, hoverActions, selected = false, disabled = false, onSelect, dense = false, className, onKeyDown, ...rest },
  ref,
) {
  const interactive = Boolean(onSelect) && !disabled
  // The `···` may only overlay the corner when nothing else lives on the right edge; otherwise it
  // would sit on top of the Toggle / unread Badge (both are hit targets of their own).
  const overlayActions = Boolean(hoverActions) && !trailing
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || !interactive) return
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      onSelect?.()
    }
  }
  return (
    <div
      ref={ref}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-selected={interactive ? selected : undefined}
      aria-disabled={disabled || undefined}
      data-selected={selected || undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative flex w-full select-none items-center gap-2.5 rounded-item px-2.5 text-left outline-none',
        dense ? 'min-h-11 py-1.5' : 'min-h-14 py-2',
        'transition-colors duration-(--dur-fast)',
        interactive && 'cursor-pointer hover:bg-hover-5 data-[hover]:bg-hover-5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70',
        selected && 'bg-accent-12 hover:bg-accent-12',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      {...rest}
    >
      {leading ? <div className="flex size-9 shrink-0 items-center justify-center">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-medium leading-4.5 text-fg">{title}</span>
          {meta ? <span className={cn('shrink-0 font-latin text-micro text-fg-3', overlayActions && 'group-hover:hidden group-focus-within:hidden group-data-[hover]:hidden')}>{meta}</span> : null}
        </div>
        {subtitle ? <div className="flex min-w-0 items-center gap-1.5 truncate text-caption leading-4 text-fg-3">{subtitle}</div> : null}
      </div>
      {trailing || (hoverActions && !overlayActions) ? (
        <div className="flex shrink-0 items-center gap-1">
          {hoverActions && !overlayActions ? (
            // `invisible` (not `hidden`) so the slot keeps its width: revealing it must not shove the
            // Toggle / Badge sideways under the pointer.
            <div
              className="invisible flex items-center gap-0.5 group-hover:visible group-focus-within:visible group-data-[hover]:visible"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {hoverActions}
            </div>
          ) : null}
          {trailing}
        </div>
      ) : null}
      {overlayActions ? (
        <div
          className="absolute right-2 top-2 hidden items-center gap-0.5 group-hover:flex group-focus-within:flex group-data-[hover]:flex"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {hoverActions}
        </div>
      ) : null}
    </div>
  )
})
