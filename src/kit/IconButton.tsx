import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cn } from './cn'
import { ICON_STROKE, type IconComponent } from './icon'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'

/**
 * IconButton — square icon-only button, four states (default / hover / pressed / active).
 * Figma 154:625: 28×28 r6, icon 15; active = accent 15% ground + accent icon.
 * `label` is required: it is the accessible name (and what a Tooltip should repeat).
 * Hover = fg 7% ground, press = fill-13; disabled dims but stays hoverable for `disabledReason`.
 */
export const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center rounded-control',
    'text-fg-2 transition-colors outline-none',
    'enabled:hover:bg-hover-7 enabled:hover:text-fg enabled:active:bg-(--fill-13)',
    'disabled:cursor-not-allowed disabled:opacity-40',
    'aria-busy:cursor-progress',
    'data-[active=true]:bg-accent-15 data-[active=true]:text-accent data-[active=true]:enabled:hover:bg-accent-15',
  ],
  {
    variants: {
      size: {
        default: 'size-7',
        sm: 'size-6',
        xs: 'size-5',
      },
      tone: {
        default: '',
        danger: 'enabled:hover:text-danger',
      },
    },
    defaultVariants: { size: 'default', tone: 'default' },
  },
)

const ICON_BY_SIZE = { default: 15, sm: 14, xs: 12 } as const

export interface IconButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  icon: IconComponent
  /** Accessible name — required, there is no visible text. */
  label: string
  /** Selected / toggled-on state: accent ground + accent icon. */
  active?: boolean
  loading?: boolean
  /** Override the icon size (defaults to 15 / 14 / 12 by button size). */
  iconSize?: number
  /** Why the button is disabled: a tooltip on hover plus the accessible description (CLAUDE.md §4.6). */
  disabledReason?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    active = false,
    loading = false,
    size,
    tone,
    iconSize,
    disabled,
    disabledReason,
    className,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const resolvedIcon = iconSize ?? ICON_BY_SIZE[size ?? 'default']
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) return
    onClick?.(event)
  }
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      aria-description={disabled && disabledReason ? disabledReason : undefined}
      data-active={active || undefined}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      onClick={handleClick}
      className={cn(iconButtonVariants({ size, tone }), className)}
      {...rest}
    >
      {loading ? (
        <Spinner size={resolvedIcon <= 12 ? 12 : 13} className="text-current" />
      ) : (
        <Icon size={resolvedIcon} strokeWidth={ICON_STROKE} aria-hidden />
      )}
    </button>
  )
  if (!disabled || !disabledReason) return button
  return (
    <Tooltip content={disabledReason}>
      <span className="inline-flex">{button}</span>
    </Tooltip>
  )
})
