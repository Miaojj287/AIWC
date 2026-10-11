import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE } from './icon'

export type InlineHintKind = 'success' | 'info' | 'warning' | 'error'

export interface InlineHintProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  kind: InlineHintKind
  children: ReactNode
  /** Single line with an ellipsis (status lines in tight headers); the full text stays in `title`. */
  truncate?: boolean
  /**
   * Announce as an alert when it appears. Defaults to true for `error` (a validation message after input); pass
   * false for an error that is simply part of the page on open, so it does not interrupt.
   */
  live?: boolean
}

const KIND = {
  success: { icon: CircleCheck, className: 'text-ok-ink' },
  info: { icon: Info, className: 'text-info-ink' },
  warning: { icon: TriangleAlert, className: 'text-warn-ink' },
  error: { icon: CircleAlert, className: 'text-danger-ink' },
} as const

/**
 * 行内提示 — four kinds (Figma 154:913): icon 12 + text 11.5 in the semantic colour.
 * Used under form controls for validation and next to field labels for status.
 */
export function InlineHint({ kind, children, className, truncate = false, live, title, ...rest }: InlineHintProps) {
  const { icon: Icon, className: tone } = KIND[kind]
  const alert = live ?? kind === 'error'
  return (
    <div
      role={alert ? 'alert' : undefined}
      title={title ?? (truncate && typeof children === 'string' ? children : undefined)}
      className={cn('flex items-center gap-1.5 text-note leading-4', truncate && 'min-w-0', tone, className)}
      {...rest}
    >
      <Icon size={ICON_SIZE.inline} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
      {/* The ellipsis must sit on the text's own block box: `truncate` on the flex container only clips. */}
      <span className={cn('min-w-0', truncate ? 'truncate' : 'break-words')}>{children}</span>
    </div>
  )
}
