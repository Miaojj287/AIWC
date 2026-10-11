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
  /**
   * Compact = 32px single-line navigation row (the Agent window sidebar): 16px leading slot (icon or status), title
   * 13 Regular, meta on the right; no subtitle. Implies `quiet`.
   */
  compact?: boolean
  /**
   * Neutral selection — the settings nav's raised ground instead of the accent tint and ring. For navigation rows that
   * sit beside a conversation (the Agent window sidebar), where a blue block would be the loudest thing on screen.
   */
  quiet?: boolean
  /** Native tooltip for the whole row (the truncated title already repeats itself when it is a string). */
  tooltip?: string
}

/**
 * ListItem — the one row for sessions, contacts and rules (CLAUDE.md §3):
 * avatar 36 r8 | title 13 Medium + subtitle 12 weak | meta / badge / toggle on the right.
 * selected = `--selected-bg` ground + `--selected-ring` inner ring (greyed while the window is inactive); hover = fg 5%,
 * press = fg 7%, and hover reveals `···`. Right-click → the same menu (wrap in ContextMenuTrigger).
 * `data-hover` forces the hover look (gallery / screenshots). Selection changes at once: rows are switched all day.
 */
export const ListItem = forwardRef<HTMLDivElement, ListItemProps>(function ListItem(
  {
    leading,
    title,
    subtitle,
    meta,
    trailing,
    hoverActions,
    selected = false,
    disabled = false,
    onSelect,
    dense = false,
    compact = false,
    quiet = compact,
    tooltip,
    className,
    onKeyDown,
    ...rest
  },
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
      aria-current={selected ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      data-selected={selected || undefined}
      title={tooltip}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'kit-row group relative flex w-full select-none items-center gap-3 rounded-item px-3 text-left outline-none',
        compact ? 'min-h-8 gap-2 px-2.5 py-1' : dense ? 'min-h-11 py-1.5' : 'min-h-14 py-2',
        interactive && 'cursor-pointer hover:bg-hover-5 active:bg-hover-7 data-[hover]:bg-hover-5',
        selected &&
          (quiet
            ? 'bg-raised hover:bg-raised active:bg-raised data-[hover]:bg-raised'
            : 'bg-selected ring-1 ring-inset ring-selected-ring hover:bg-selected active:bg-selected'),
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      {...rest}
    >
      {/* A compact row keeps its empty 16px slot so titles line up whether or not a status shows. */}
      {leading || compact ? (
        <div className={cn('flex shrink-0 items-center justify-center', compact ? 'size-4' : 'size-9')}>{leading}</div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-body text-fg',
              compact ? 'font-normal leading-6' : 'font-medium leading-4.5',
            )}
            title={typeof title === 'string' ? title : undefined}
          >
            {title}
          </span>
          {meta ? (
            <span
              className={cn(
                'shrink-0 font-latin text-micro text-fg-3',
                overlayActions && 'group-hover:hidden group-focus-within:hidden group-data-[hover]:hidden',
              )}
            >
              {meta}
            </span>
          ) : null}
        </div>
        {/* A block box, not a flex row: text-overflow only renders on the box that owns the text, so a plain
            string subtitle inside `flex … truncate` used to clip mid-glyph. Callers that mix a dot / Badge with
            text wrap them in their own `flex` span, whose truncating child still gets the ellipsis. */}
        {subtitle && !compact ? (
          <div
            className="min-w-0 truncate text-caption leading-4 text-fg-3 [&>*+*]:ml-1.5"
            title={typeof subtitle === 'string' ? subtitle : undefined}
          >
            {subtitle}
          </div>
        ) : null}
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
          className={cn(
            'absolute hidden items-center gap-0.5 group-hover:flex group-focus-within:flex group-data-[hover]:flex',
            compact ? 'inset-y-0 right-1' : 'right-2 top-2',
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {hoverActions}
        </div>
      ) : null}
    </div>
  )
})
