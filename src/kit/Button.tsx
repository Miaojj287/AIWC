import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'
import { Spinner } from './Spinner'

/**
 * Button — the only five kinds allowed (CLAUDE.md §3): primary / ghost / outline / danger / link.
 * One primary per screen; danger only inside destructive confirmations; link for inline actions.
 * Figma 154:419. h30 r6 px12 gap6, label 12.5 Medium, icon 13; sm = h26.
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap',
    'rounded-control font-medium transition-colors duration-(--dur-fast)',
    'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
    'disabled:pointer-events-none disabled:opacity-40',
    'aria-busy:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-(--fg-on-accent) hover:bg-accent-hover active:bg-accent-active',
        ghost: 'border border-line-6 bg-line-8 text-fg hover:bg-(--fill-13) active:bg-(--line-16)',
        outline: 'border border-(--line-16) text-fg hover:border-(--line-25) hover:bg-(--fill-13) active:bg-(--line-16)',
        danger: 'bg-danger text-white hover:brightness-[1.08] active:brightness-[0.9]',
        link: 'text-accent hover:bg-accent/8 active:bg-accent/14',
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
  /** Replaces the leading icon with a spinner, disables the button and sets aria-busy. */
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon: Icon, trailingIcon: TrailingIcon, loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 12 : ICON_SIZE.button
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
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
})
