import { CircleAlert, Inbox, Loader, Search } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'

export type EmptyStateVariant = 'empty' | 'loading' | 'error' | 'no-results'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: IconComponent
  variant?: ButtonProps['variant']
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: EmptyStateVariant
  /** Override the default icon for the variant. */
  icon?: IconComponent
  title: ReactNode
  description?: ReactNode
  /** Primary action (empty → primary button; error / no-results → ghost). Hidden while loading. */
  action?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  /** Draw the card frame (panel ground + line-6 + r12) as on the component board. */
  bordered?: boolean
  /** Tighter spacing for narrow columns (icon 36, title 13). */
  compact?: boolean
}

const VARIANT: Record<EmptyStateVariant, { icon: IconComponent; box: string; spin?: boolean; button: ButtonProps['variant'] }> = {
  empty: { icon: Inbox, box: 'bg-line-8 text-fg-3', button: 'primary' },
  loading: { icon: Loader, box: 'bg-accent-15 text-accent', spin: true, button: 'ghost' },
  error: { icon: CircleAlert, box: 'bg-danger/15 text-danger', button: 'ghost' },
  'no-results': { icon: Search, box: 'bg-line-8 text-fg-3', button: 'ghost' },
}

/**
 * EmptyState — the one template for empty / loading / error / no-results (CLAUDE.md §4.7).
 * Figma 154:1191: icon box 44 r12 + title 14 Medium + description 12 weak + optional buttons.
 */
export function EmptyState({ variant = 'empty', icon, title, description, action, secondaryAction, bordered = false, compact = false, className, ...rest }: EmptyStateProps) {
  const meta = VARIANT[variant]
  const Icon = icon ?? meta.icon
  const showActions = variant !== 'loading' && (action || secondaryAction)
  return (
    <div
      role={variant === 'loading' ? 'status' : variant === 'error' ? 'alert' : undefined}
      aria-busy={variant === 'loading' || undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        bordered && 'rounded-card border border-line-6 bg-panel',
        compact ? 'px-4 py-6' : 'px-6 py-10',
        className,
      )}
      {...rest}
    >
      <div className={cn('flex shrink-0 items-center justify-center rounded-card', meta.box, compact ? 'size-9' : 'size-11')}>
        <Icon size={compact ? 18 : ICON_SIZE.emptyState} strokeWidth={ICON_STROKE} aria-hidden className={meta.spin ? 'animate-spin' : undefined} />
      </div>
      <div className={cn('font-medium text-fg', compact ? 'text-body' : 'text-bubble')}>{title}</div>
      {description ? <div className="max-w-[320px] text-caption text-fg-3">{description}</div> : null}
      {showActions ? (
        <div className="mt-1 flex items-center gap-2">
          {action ? (
            <Button variant={action.variant ?? meta.button} icon={action.icon} onClick={action.onClick} size={compact ? 'sm' : 'default'}>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button variant={secondaryAction.variant ?? 'link'} icon={secondaryAction.icon} onClick={secondaryAction.onClick} size={compact ? 'sm' : 'default'}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
