import { Search, X } from 'lucide-react'
import { forwardRef, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE } from './icon'
import { IconButton } from './IconButton'
import { mergeRefs } from './internal/refs'

export interface SearchBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onSubmit' | 'size' | 'type'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Enter. */
  onSubmit?: (value: string) => void
  /** h32 (default) / h28 (sm — list headers). */
  size?: 'default' | 'sm'
  /** Optional trailing keyboard hint shown when empty (e.g. "⌘K"). */
  shortcut?: string
  wrapperClassName?: string
}

/**
 * SearchBox — Input with a search glyph, focus = accent border, × clears when there is text.
 * Figma 154:835. Escape clears first, then blurs.
 */
export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { value, defaultValue, onValueChange, onSubmit, size = 'default', shortcut, wrapperClassName, className, placeholder = '搜索', disabled, onKeyDown, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null)
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '')
  const isControlled = value !== undefined
  const current = isControlled ? value : uncontrolled

  const setValue = (next: string) => {
    if (!isControlled) setUncontrolled(next)
    onValueChange?.(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === 'Enter') {
      onSubmit?.(current)
    } else if (e.key === 'Escape') {
      if (current) {
        e.preventDefault()
        setValue('')
      } else {
        inner.current?.blur()
      }
    }
  }

  return (
    <div
      role="search"
      data-disabled={disabled || undefined}
      className={cn(
        'flex items-center gap-2 rounded-control border border-line-8 bg-content pl-2.5 pr-1.5 text-caption text-fg',
        'transition-colors duration-(--dur-fast) hover:border-(--line-16) focus-within:border-accent/80 focus-within:hover:border-accent/80',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        size === 'sm' ? 'h-7' : 'h-8',
        wrapperClassName,
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          inner.current?.focus()
        }
      }}
    >
      <Search size={ICON_SIZE.input} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      <input
        ref={mergeRefs(ref, inner)}
        type="search"
        value={current}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-caption text-fg caret-accent outline-none placeholder:text-fg-3',
          '[&::-webkit-search-cancel-button]:hidden',
          className,
        )}
        {...rest}
      />
      {current ? (
        <IconButton size="xs" icon={X} iconSize={ICON_SIZE.inputTrailing} label="清除" tabIndex={-1} onClick={() => setValue('')} className="text-fg-3" />
      ) : shortcut ? (
        <span className="pr-1 font-latin text-micro text-fg-3">{shortcut}</span>
      ) : null}
    </div>
  )
})
