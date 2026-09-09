import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from './cn'
import { ICON_STROKE, type IconComponent } from './icon'

/**
 * Badge — semantic pill: colour @14% ground + @30% border + 100% text (CLAUDE.md §2.2).
 * Figma 154:944. Tones: ok / warn / danger / info / clone / neutral / accent.
 * Neutral has no colour of its own: it uses the grey overlay scale (line-8 ground + line-16 border).
 */
export const badgeVariants = cva(
  'inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-chip border px-[7px] text-micro font-medium leading-none',
  {
    variants: {
      tone: {
        ok: 'border-ok/30 bg-ok/14 text-ok',
        warn: 'border-warn/30 bg-warn/14 text-warn',
        danger: 'border-danger/30 bg-danger/14 text-danger',
        info: 'border-info/30 bg-info/14 text-info',
        clone: 'border-clone/30 bg-clone/14 text-clone',
        accent: 'border-accent/30 bg-accent/14 text-accent',
        neutral: 'border-(--line-16) bg-line-8 text-fg-3',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

const DOT_TONE = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  clone: 'bg-clone',
  accent: 'bg-accent',
  neutral: 'bg-fg-3',
} as const

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  icon?: IconComponent
  /** Render as a 6px dot only (e.g. muted-unread indicator). */
  dot?: boolean
}

export function Badge({ tone, icon: Icon, dot = false, className, children, ...rest }: BadgeProps) {
  if (dot) {
    return <span className={cn('inline-block size-1.5 shrink-0 rounded-chip', DOT_TONE[tone ?? 'neutral'], className)} {...rest} />
  }
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {Icon ? <Icon size={10} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      {children}
    </span>
  )
}
