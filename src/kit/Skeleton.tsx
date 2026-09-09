import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type SkeletonProps = HTMLAttributes<HTMLDivElement>

/** Skeleton — a pulsing placeholder block; size it with className. */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-line-8', className)} {...rest} />
}

export interface SkeletonListRowsProps extends HTMLAttributes<HTMLDivElement> {
  rows?: number
  /** Show the 36px avatar block (default true). */
  avatar?: boolean
}

/** Skeleton rows shaped like ListItem: avatar 36 r8 + 10px title line + 8px subtitle line. Figma 154:980. */
export function SkeletonListRows({ rows = 3, avatar = true, className, ...rest }: SkeletonListRowsProps) {
  return (
    <div role="status" aria-label="加载中" className={cn('flex flex-col gap-2.5', className)} {...rest}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5">
          {avatar ? <Skeleton className="size-9 shrink-0 rounded-item" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-2.5 w-[45%] max-w-[120px] rounded-chip bg-line-10" />
            <Skeleton className="h-2 w-[68%] max-w-[180px] rounded-chip bg-line-6" />
          </div>
        </div>
      ))}
    </div>
  )
}
