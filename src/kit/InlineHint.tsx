import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE } from './icon'

export type InlineHintKind = 'success' | 'info' | 'warning' | 'error'

export interface InlineHintProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  kind: InlineHintKind
  children: ReactNode
}

const KIND = {
  success: { icon: CircleCheck, className: 'text-ok' },
  info: { icon: Info, className: 'text-info' },
  warning: { icon: TriangleAlert, className: 'text-warn' },
  error: { icon: CircleAlert, className: 'text-danger' },
} as const

/**
 * 行内提示 — four kinds (Figma 154:913): icon 12 + text 11.5 in the semantic colour.
 * Used under form controls for validation and next to field labels for status.
 */
export function InlineHint({ kind, children, className, ...rest }: InlineHintProps) {
  const { icon: Icon, className: tone } = KIND[kind]
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      className={cn('flex items-center gap-1.5 text-note leading-4', tone, className)}
      {...rest}
    >
      <Icon size={ICON_SIZE.inline} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}
