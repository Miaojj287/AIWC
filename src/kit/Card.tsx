import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header: title 13 Medium + description 11.5 weak + actions on the right. */
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** `default` pads 16; `rows` has no padding so SettingRows run edge to edge with their own 16px inset. */
  variant?: 'default' | 'rows'
}

/**
 * Card — panel ground + 1px line-6 + r12 + p16. NO shadow (CLAUDE.md §2.1); shadows are for floating layers only.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { title, description, actions, variant = 'default', className, children, ...rest },
  ref,
) {
  const hasHeader = title || description || actions
  return (
    <div
      ref={ref}
      className={cn('rounded-card border border-line-6 bg-panel', variant === 'default' && 'p-4', className)}
      {...rest}
    >
      {hasHeader ? (
        <div className={cn('flex items-start gap-3', variant === 'rows' ? 'border-b border-line-6 px-4 py-3' : 'mb-3')}>
          <div className="min-w-0 flex-1">
            {title ? <div className="text-body font-medium leading-5 text-fg">{title}</div> : null}
            {description ? <div className="mt-0.5 text-note text-fg-3">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
})
