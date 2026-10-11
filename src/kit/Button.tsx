import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'

/**
 * Button — the only five kinds allowed (CLAUDE.md §3): primary / ghost / outline / danger / link.
 * One primary per independent task section; danger only inside destructive confirmations; link for inline actions.
 * Figma 154:419. h30 r6 px12 gap6, label 12.5 Medium, icon 13; sm = h26.
 *
 * States: hover and press change colour at once (no scale); a disabled button dims and keeps pointer events so
 * `disabledReason` can explain itself in a tooltip (CLAUDE.md §4.6); a loading button keeps its colour and shows a
 * spinner while its click is ignored.
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap',
    'rounded-control font-medium transition-colors outline-none',
    'disabled:cursor-not-allowed disabled:opacity-40',
    'aria-busy:cursor-progress',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-(--fg-on-accent) enabled:hover:bg-accent-hover enabled:active:bg-accent-active',
        ghost: 'border border-line-6 bg-hover-7 text-fg enabled:hover:bg-(--fill-13) enabled:active:bg-(--fill-20)',
        outline:
          'border border-(--line-16) text-fg enabled:hover:border-(--line-25) enabled:hover:bg-(--fill-13) enabled:active:bg-(--fill-20)',
        danger: 'bg-danger text-white enabled:hover:bg-danger-hover enabled:active:bg-danger-active',
        link: 'text-accent-ink enabled:hover:bg-accent-12 enabled:active:bg-accent-15',
      },
      size: {
        default: 'h-[30px] gap-1.5 px-3 text-tab',
        sm: 'h-[26px] gap-1 px-2.5 text-caption',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Leading lucide icon (rendered at 13px, stroke 1.75). */
  icon?: IconComponent
  /** Trailing lucide icon. */
  trailingIcon?: IconComponent
  /** Replaces the leading icon with a spinner, sets aria-busy and ignores clicks; the button keeps its colour. */
  loading?: boolean
  /** Why the button is disabled: shown as a tooltip on hover and as the accessible description (CLAUDE.md §4.6). */
  disabledReason?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size,
    icon: Icon,
    trailingIcon: TrailingIcon,
    loading = false,
    disabled,
    disabledReason,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 12 : ICON_SIZE.button
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) return
    onClick?.(event)
  }
  const button = (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-description={disabled && disabledReason ? disabledReason : undefined}
      data-loading={loading || undefined}
      onClick={handleClick}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize === 12 ? 12 : 13} className="text-current" />
      ) : Icon ? (
        <Icon size={iconSize} strokeWidth={ICON_STROKE} aria-hidden />
      ) : null}
      {children}
      {TrailingIcon ? <TrailingIcon size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /> : null}
    </button>
  )
  if (!disabled || !disabledReason) return button
  // A disabled button emits no pointer events, so the wrapper is the tooltip trigger.
  return (
    <Tooltip content={disabledReason}>
      <span className="inline-flex max-w-full">{button}</span>
    </Tooltip>
  )
})
