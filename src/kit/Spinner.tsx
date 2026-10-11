import { Loader } from 'lucide-react'
import { forwardRef, type HTMLAttributes } from 'react'
import { useT } from '@/i18n'
import { cn } from './cn'
import { ICON_STROKE } from './icon'

export type SpinnerSize = 12 | 13 | 16 | 24

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 12 / 16 / 24 per the component board; 13 matches the button icon slot. */
  size?: SpinnerSize
  /** Accessible label; defaults to 加载中. Only read out when `announce` is set. */
  label?: string
  /**
   * Make the spinner its own live region. Off by default: the busy state usually belongs to the control or region
   * around it (`aria-busy`, an EmptyState, a status row), and thirty parallel "loading" regions drown the reader.
   */
  announce?: boolean
}

/** Rotating lucide loader. Inherits `color`; defaults to the accent. */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 16, label, announce = false, className, ...rest },
  ref,
) {
  const t = useT()
  return (
    <span
      ref={ref}
      role={announce ? 'status' : undefined}
      aria-label={announce ? (label ?? t('kit.loading')) : undefined}
      aria-hidden={announce ? undefined : true}
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Loader size={size} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden />
    </span>
  )
})
