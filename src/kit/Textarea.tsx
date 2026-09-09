import { forwardRef, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'
import { InlineHint } from './InlineHint'
import { mergeRefs } from './internal/refs'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with content between `minRows` and `maxRows`. */
  autosize?: boolean
  minRows?: number
  maxRows?: number
  mono?: boolean
  error?: boolean | ReactNode
  hint?: ReactNode
  wrapperClassName?: string
}

const LINE_HEIGHT = 18
const PADDING_Y = 16

/**
 * Textarea — same frame as Input (content ground, line-8 border, r6), 12px / 18px line-height, padding 10×8.
 * Figma 154:761. `autosize` resizes on every value change.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { autosize = false, minRows = 3, maxRows = 12, mono = false, error, hint, wrapperClassName, className, disabled, value, defaultValue, rows, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement>(null)
  const invalid = Boolean(error)
  const errorNode = typeof error === 'boolean' ? null : error

  useLayoutEffect(() => {
    const el = inner.current
    if (!autosize || !el) return
    const fit = (): void => {
      el.style.height = 'auto'
      const min = minRows * LINE_HEIGHT + PADDING_Y
      const max = maxRows * LINE_HEIGHT + PADDING_Y
      const next = Math.min(max, Math.max(min, el.scrollHeight))
      el.style.height = `${next}px`
      el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
    }
    fit()
    // The first measurement can happen before flexbox has given the textarea its real width, and a
    // narrow measurement wraps one line into ten — the field then opens at maxRows and stays there.
    // Re-fit whenever the width actually changes; height changes are ours and must not feed back.
    if (typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [autosize, minRows, maxRows, value, defaultValue])

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wrapperClassName)}>
      <textarea
        ref={mergeRefs(ref, inner)}
        disabled={disabled}
        rows={rows ?? minRows}
        value={value}
        defaultValue={defaultValue}
        aria-invalid={invalid || undefined}
        className={cn(
          'block w-full resize-y rounded-control border border-line-8 bg-content px-2.5 py-2 text-caption leading-4.5 text-fg',
          'caret-accent outline-none transition-colors duration-(--dur-fast) placeholder:text-fg-3',
          'hover:border-(--line-16) focus:border-accent/80 focus:hover:border-accent/80',
          'aria-invalid:border-danger/80 aria-invalid:hover:border-danger/80',
          'disabled:cursor-not-allowed disabled:opacity-45',
          autosize && 'resize-none',
          mono && 'font-mono',
          className,
        )}
        {...rest}
      />
      {errorNode ? <InlineHint kind="error">{errorNode}</InlineHint> : null}
      {hint && !errorNode ? <div className="text-note text-fg-3">{hint}</div> : null}
    </div>
  )
})
