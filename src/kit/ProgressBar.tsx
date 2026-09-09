import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0–100. Omit for the indeterminate sliding segment. */
  value?: number
  /** Accessible label. */
  label?: string
}

/** ProgressBar — 6px track (line-10) + accent fill; indeterminate = sliding segment. Figma 154:953. */
export function ProgressBar({ value, label, className, ...rest }: ProgressBarProps) {
  const determinate = typeof value === 'number' && Number.isFinite(value)
  const pct = determinate ? Math.min(100, Math.max(0, value)) : undefined
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-chip bg-line-10', className)}
      {...rest}
    >
      {determinate ? (
        <div
          className="h-full rounded-chip bg-accent transition-[width] duration-(--dur-base) ease-out"
          style={{ width: `${pct}%` }}
        />
      ) : (
        <div className="kit-indeterminate h-full w-[35%] rounded-chip bg-accent" />
      )}
    </div>
  )
}
