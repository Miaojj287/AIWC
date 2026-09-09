import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export interface SettingRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 13 Medium. */
  title: ReactNode
  /** 11.5 weak, directly under the title (CLAUDE.md §2.3). */
  description?: ReactNode
  /** Badge next to the title (e.g. 本地). */
  badge?: ReactNode
  /** The control (Toggle / Select / SegmentedControl / Button). */
  children?: ReactNode
  /** Control spans the full width below the text (inputs, editors). */
  stacked?: boolean
  /** Inline validation / status rendered under the control. */
  footer?: ReactNode
  disabled?: boolean
  /** Associate the title with a control id for screen readers. */
  htmlFor?: string
}

/**
 * SettingRow — the ONLY settings row (CLAUDE.md §3): title + description on the left, control on the right,
 * 1px line-6 between rows (none after the last). Place rows inside <Card variant="rows">.
 */
export function SettingRow({ title, description, badge, children, stacked = false, footer, disabled = false, htmlFor, className, ...rest }: SettingRowProps) {
  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-body font-medium leading-4.5 text-fg">
          {title}
        </label>
        {badge}
      </div>
      {description ? <div className="text-note leading-4 text-fg-3">{description}</div> : null}
    </div>
  )
  return (
    <div
      aria-disabled={disabled || undefined}
      className={cn(
        'flex flex-col gap-2.5 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line-6',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      {...rest}
    >
      {stacked ? (
        <>
          {text}
          {children ? <div className="min-w-0">{children}</div> : null}
        </>
      ) : (
        <div className="flex items-center gap-4">
          {text}
          {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
        </div>
      )}
      {footer}
    </div>
  )
}
