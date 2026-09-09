import { X } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
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
 * Chip — r100 pill. Filter: default weak text, selected = accent 12% ground + accent text.
 * Mention: accent chip with icon + ×, used for @ context references (CLAUDE.md §5).
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { variant = 'filter', label, count, selected = false, icon: Icon, onRemove, className, disabled, type = 'button', ...rest },
  ref,
) {
  const isMention = variant === 'mention'
  const handleRemove = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    onRemove?.()
  }
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-pressed={!isMention ? selected : undefined}
      data-selected={selected || undefined}
      className={cn(
        'inline-flex h-6 shrink-0 select-none items-center gap-1 whitespace-nowrap rounded-chip px-2.5 text-caption leading-none',
        'transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        'disabled:pointer-events-none disabled:opacity-40',
        isMention
          ? 'bg-accent-12 pl-2 pr-1.5 font-medium text-accent hover:bg-accent-15'
          : selected
            ? 'bg-accent-12 font-medium text-accent'
            : 'bg-line-6 text-fg-2 hover:bg-line-10 hover:text-fg',
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={ICON_SIZE.chip} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      <span className="truncate">{label}</span>
      {typeof count === 'number' ? (
        <span className={cn('font-latin tabular-nums', selected ? 'text-accent/80' : 'text-fg-3')}>{count}</span>
      ) : null}
      {isMention && onRemove ? (
        <span
          role="button"
          aria-label={`移除 ${label}`}
          tabIndex={-1}
          onClick={handleRemove}
          className="ml-0.5 inline-flex size-4 items-center justify-center rounded-chip hover:bg-accent/20"
        >
          <X size={11} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
      ) : null}
    </button>
  )
})
