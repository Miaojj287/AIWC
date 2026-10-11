import { X } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react'
import { useT } from '@/i18n'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** `filter` — list-header filter (全部 / 单聊 / 群聊) with live count; `mention` — @ reference in the Agent composer. */
  variant?: 'filter' | 'mention'
  label: string
  /** Live count shown after the label (filter chips). */
  count?: number
  selected?: boolean
  icon?: IconComponent
  /** Mention chips show an × that calls this. */
  onRemove?: () => void
}

/**
 * Chip — r100 pill. Filter: plain secondary text, selected = neutral 13% fill + primary text (a default filter is
 * always selected, so an accent there would greet every first visit with blue).
 * Mention: accent chip with icon + ×, used for @ context references (CLAUDE.md §5).
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    variant = 'filter',
    label,
    count,
    selected = false,
    icon: Icon,
    onRemove,
    className,
    disabled,
    type = 'button',
    onKeyDown,
    ...rest
  },
  ref,
) {
  const t = useT()
  const isMention = variant === 'mention'
  const handleRemove = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    onRemove?.()
  }
  // Delete / Backspace on a focused mention chip removes it: the × is a pointer shortcut, not a second control.
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || !isMention || !onRemove) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemove()
    }
  }
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-pressed={!isMention ? selected : undefined}
      aria-keyshortcuts={isMention && onRemove ? 'Delete' : undefined}
      aria-description={isMention && onRemove ? t('kit.chip.remove', { label }) : undefined}
      data-selected={selected || undefined}
      title={label}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex h-6 max-w-full select-none items-center gap-1 whitespace-nowrap rounded-chip px-2.5 text-caption leading-none',
        // A filter chip keeps its label whole (a row of 全部 / 单聊 / 群聊 must never read 「…40」); a mention chip may
        // shrink inside its max width and ellipsize the name.
        isMention ? 'min-w-0' : 'shrink-0',
        'transition-colors outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        isMention
          ? 'bg-accent-12 pl-2 pr-1.5 font-medium text-accent-ink enabled:hover:bg-accent-15 enabled:active:bg-accent-30'
          : selected
            ? 'bg-(--fill-13) font-medium text-fg enabled:active:bg-(--fill-20)'
            : 'text-fg-2 enabled:hover:bg-hover-7 enabled:hover:text-fg enabled:active:bg-(--fill-13)',
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={ICON_SIZE.chip} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      <span className="min-w-0 truncate">{label}</span>
      {typeof count === 'number' ? (
        <span className={cn('font-latin tabular-nums', selected ? 'text-fg-2' : 'text-fg-3')}>
          {count > 999 ? '999+' : count}
        </span>
      ) : null}
      {isMention && onRemove ? (
        <span
          aria-hidden
          onClick={handleRemove}
          className="ml-0.5 inline-flex size-4 items-center justify-center rounded-chip hover:bg-accent-30"
        >
          <X size={11} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
      ) : null}
    </button>
  )
})
