import { Loader } from 'lucide-react'
import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from './cn'
import { ICON_STROKE } from './icon'

export type SpinnerSize = 12 | 13 | 16 | 24

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 12 / 16 / 24 per the component board; 13 matches the button icon slot. */
  size?: SpinnerSize
  /** Accessible label; defaults to 加载中. */
  label?: string
}

/** Rotating lucide loader. Inherits `color`; defaults to the accent. */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 16, label = '加载中', className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      role="status"
      aria-label={label}
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Loader size={size} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden />
    </span>
  )
})
