import { CircleQuestionMark } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from './cn'
import { ICON_STROKE } from './icon'
import { Tooltip } from './Tooltip'

export interface HelpTipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'content'> {
  /** The explanation shown on hover / focus; wraps at 240px. */
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Glyph size, default 13 (12 next to 12.5px field labels). */
  size?: number
  /** What it explains, for the accessible name (kit.helpFor); several tips on one page stay distinct. */
  subject?: string
}

/**
 * HelpTip — the ? glyph that stands in for explanatory copy. The row / label keeps one short line; anything
 * longer lives behind this icon (CLAUDE.md §2.3). 16px hit box, weak icon, hover = secondary text, keyboard
 * focusable so the tooltip also opens on Tab. Use `SettingRow help` / `Section help` / `FieldLabel help`
 * rather than placing it by hand.
 */
export const HelpTip = forwardRef<HTMLButtonElement, HelpTipProps>(function HelpTip(
  { content, side = 'top', size = 13, subject, className, ...rest },
  ref,
) {
  const t = useT()
  return (
    <Tooltip content={content} side={side} multiline>
      <button
        ref={ref}
        type="button"
        aria-label={subject ? t('kit.helpFor', { subject }) : t('kit.help')}
        className={cn(
          'inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-chip text-fg-3 outline-none',
          'transition-colors duration-(--dur-fast) hover:text-fg-2 focus-visible:ring-2 focus-visible:ring-accent/70',
          className,
        )}
        {...rest}
      >
        <CircleQuestionMark size={size} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </Tooltip>
  )
})
