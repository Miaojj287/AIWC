import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'
import { ICON_STROKE, type IconComponent } from './icon'
import { Spinner } from './Spinner'

/**
 * IconButton — square icon-only button, four states (default / hover / pressed / active).
 * Figma 154:625: 28×28 r6, icon 15; active = accent 15% ground + accent icon.
 * `label` is required: it is the accessible name (and what a Tooltip should repeat).
 */
export const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center rounded-control',
    'text-fg-2 transition-colors duration-(--dur-fast)',
    'hover:bg-line-8 hover:text-fg active:bg-(--fill-13)',
    'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
    'disabled:pointer-events-none disabled:opacity-40',
    'data-[active=true]:bg-accent-15 data-[active=true]:text-accent data-[active=true]:hover:bg-accent-15',
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
        danger: 'hover:text-danger',
      },
    },
    defaultVariants: { size: 'default', tone: 'default' },
  },
)

const ICON_BY_SIZE = { default: 15, sm: 14, xs: 12 } as const

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  icon: IconComponent
  /** Accessible name — required, there is no visible text. */
  label: string
  /** Selected / toggled-on state: accent ground + accent icon. */
  active?: boolean
  loading?: boolean
  /** Override the icon size (defaults to 15 / 14 / 12 by button size). */
  iconSize?: number
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, active = false, loading = false, size, tone, iconSize, disabled, className, type = 'button', ...rest },
  ref,
) {
  const resolvedIcon = iconSize ?? ICON_BY_SIZE[size ?? 'default']
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      data-active={active || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
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
})
