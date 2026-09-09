import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useRef, useState, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'
import { IconButton } from './IconButton'
import { InlineHint } from './InlineHint'
import { mergeRefs } from './internal/refs'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Leading lucide icon, 13px, weak colour. */
  icon?: IconComponent
  /** Trailing slot — IconButtons (size xs) or a Badge. */
  trailing?: ReactNode
  /** Monospace face for paths / wxid / keys / model ids (CLAUDE.md §2.3). */
  mono?: boolean
  /** `true` paints the error border; a string / node also renders the inline error under the field. */
  error?: boolean | ReactNode
  /** Neutral helper text under the field (11.5 weak). */
  hint?: ReactNode
  /** h32 (default) / h28 (sm — list headers, dialog rows). */
  size?: 'default' | 'sm'
  /** Adds the 👁 reveal toggle. Defaults to true for type="password". */
  revealable?: boolean
  wrapperClassName?: string
}

/**
 * Input — 6 states (Figma 154:738): default / hover / focus (accent border, accent caret) / error / disabled / with icons.
 * Content ground, 1px line-8 border, r6, text 12. Validation goes under the control (CLAUDE.md §4.6).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon: Icon, trailing, mono = false, error, hint, size = 'default', revealable, wrapperClassName, className, type = 'text', disabled, onMouseDown, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null)
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const showReveal = revealable ?? isPassword
  const resolvedType = isPassword && revealed ? 'text' : type
  const invalid = Boolean(error)
  const errorNode = typeof error === 'boolean' ? null : error

  const focusInner = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && inner.current) {
      e.preventDefault()
      inner.current.focus()
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wrapperClassName)}>
      <div
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        onMouseDown={focusInner}
        className={cn(
          'flex items-center gap-2 rounded-control border border-line-8 bg-content pl-2.5 pr-2 text-caption text-fg',
          'transition-colors duration-(--dur-fast) hover:border-(--line-16) focus-within:border-accent/80 focus-within:hover:border-accent/80',
          'data-[invalid]:border-danger/80 data-[invalid]:hover:border-danger/80 data-[invalid]:focus-within:border-danger/80',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
          size === 'sm' ? 'h-7' : 'h-8',
          className,
        )}
      >
        {Icon ? <Icon size={ICON_SIZE.input} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" /> : null}
        <input
          ref={mergeRefs(ref, inner)}
          type={resolvedType}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onMouseDown={onMouseDown}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent text-caption text-fg caret-accent outline-none placeholder:text-fg-3',
            'disabled:cursor-not-allowed',
            mono && 'font-mono',
          )}
          {...rest}
        />
        {showReveal ? (
          <IconButton
            size="xs"
            icon={revealed ? EyeOff : Eye}
            iconSize={ICON_SIZE.inputTrailing}
            label={revealed ? '隐藏' : '显示'}
            tabIndex={-1}
            onClick={() => setRevealed((v) => !v)}
            className="text-fg-3"
          />
        ) : null}
        {trailing}
      </div>
      {errorNode ? <InlineHint kind="error">{errorNode}</InlineHint> : null}
      {hint && !errorNode ? <div className="text-note text-fg-3">{hint}</div> : null}
    </div>
  )
})
