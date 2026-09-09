import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  /** Optional centred caption (11px weak). Horizontal only. */
  label?: ReactNode
  /** Line strength: 6 (default, between rows) or 8 (between regions). */
  strength?: 6 | 8
}

/** Divider — the one 1px line that separates layers (CLAUDE.md §2.1). */
export function Divider({ orientation = 'horizontal', label, strength = 6, className, ...rest }: DividerProps) {
  const line = strength === 8 ? 'bg-line-8' : 'bg-line-6'
  if (orientation === 'vertical') {
    return <div role="separator" aria-orientation="vertical" className={cn('h-full w-px self-stretch', line, className)} {...rest} />
  }
  if (!label) {
    return <div role="separator" className={cn('h-px w-full', line, className)} {...rest} />
  }
  return (
    <div role="separator" className={cn('flex w-full items-center gap-2', className)} {...rest}>
      <span className={cn('h-px flex-1', line)} />
      <span className="shrink-0 text-micro text-fg-3">{label}</span>
      <span className={cn('h-px flex-1', line)} />
    </div>
  )
}
