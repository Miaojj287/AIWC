import { useRef, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { ICON_STROKE, type IconComponent } from './icon'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  icon?: IconComponent
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string = string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onValueChange: (value: T) => void
  /** default = 26px segments; sm = 22px (list headers). */
  size?: 'default' | 'sm'
  /** Stretch segments to fill the container. */
  fullWidth?: boolean
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * SegmentedControl — two- or three-way choice (CLAUDE.md §4.3). Figma 154:812.
 * Track fg 6% p2 r6; selected = raised ground + line-8 border + Medium; hover = fg 6%; rest = weak text.
 * Keyboard: ←/→ (or ↑/↓) move and select, Home/End jump; a radiogroup with roving tabindex.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  size = 'default',
  fullWidth = false,
  disabled = false,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const enabledIndexes = () => options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)

  const moveTo = (index: number) => {
    const opt = options[index]
    if (!opt) return
    onValueChange(opt.value)
    refs.current[index]?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = enabledIndexes()
    if (enabled.length === 0) return
    const pos = enabled.indexOf(index)
    let next: number | undefined
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = enabled[(pos + 1) % enabled.length]
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = enabled[(pos - 1 + enabled.length) % enabled.length]
        break
      case 'Home':
        next = enabled[0]
        break
      case 'End':
        next = enabled[enabled.length - 1]
        break
      default:
        return
    }
    e.preventDefault()
    if (next !== undefined) moveTo(next)
  }

  const iconSize = size === 'sm' ? 12 : 13
  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex items-stretch gap-0.5 rounded-control bg-line-6 p-0.5',
        fullWidth && 'flex w-full',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || opt.disabled}
            data-state={checked ? 'checked' : 'unchecked'}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-caption leading-none',
              'transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
              'disabled:pointer-events-none disabled:opacity-40',
              size === 'sm' ? 'h-[22px] px-2' : 'h-[22px]',
              fullWidth && 'flex-1',
              checked
                ? 'border border-line-8 bg-raised font-medium text-fg'
                : 'border border-transparent text-fg-3 hover:bg-line-6 hover:text-fg',
            )}
          >
            {opt.icon ? <opt.icon size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
