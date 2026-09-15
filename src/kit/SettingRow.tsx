import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { HelpTip } from './HelpTip'

export interface SettingRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 13 Medium. */
  title: ReactNode
  /** 11.5 weak, directly under the title (CLAUDE.md §2.3). */
  description?: ReactNode
  /** Badge next to the title (e.g. 本地). */
  badge?: ReactNode
  /** Longer explanation behind a ? glyph after the title — keep `description` to one short line. */
  help?: ReactNode
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
export function SettingRow({
  title,
  description,
  badge,
  help,
  children,
  stacked = false,
  footer,
  disabled = false,
  htmlFor,
  className,
  ...rest
}: SettingRowProps) {
  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="min-w-0 truncate text-body font-medium leading-4.5 text-fg">
          {title}
        </label>
        {badge}
        {help ? <HelpTip content={help} subject={typeof title === 'string' ? title : undefined} /> : null}
      </div>
      {description ? <div className="text-note leading-4 text-fg-3">{description}</div> : null}
    </div>
  )
  return (
    <div
      aria-disabled={disabled || undefined}
      className={cn(
        '@container flex flex-col gap-2.5 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line-6',
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
        // Below ~380px (a narrow settings column at the minimum window size) the control drops under the text:
        // squeezing the text column is what used to wrap titles one character per line.
        <div className="flex flex-col items-start gap-2.5 @min-[380px]:flex-row @min-[380px]:items-center @min-[380px]:gap-4">
          {text}
          {children ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
        </div>
      )}
      {footer}
    </div>
  )
}
