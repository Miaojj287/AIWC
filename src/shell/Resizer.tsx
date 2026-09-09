import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/kit'

export interface ResizerProps {
  /** Accessible name, e.g. 调整会话列表宽度. */
  label: string
  /** Cumulative delta in px from the drag start (positive = pointer moved right). */
  onResize(delta: number): void
  /** Pointer released — persist the width. */
  onResizeEnd(): void
  /** Double-click → restore the default width. */
  onReset?(): void
  /** Current width, for aria-valuenow. */
  value?: number
  min?: number
  max?: number
  className?: string
}

const KEY_STEP = 16

/**
 * Resizer — 4px column drag handle between two columns (DESIGN-SPEC §0.1: only the Workspace absorbs
 * width changes). Overlaps the 1px column line, shows an accent hairline on hover / while dragging,
 * cursor col-resize. Keyboard: ←/→ nudge 16px, Home resets.
 */
export function Resizer({ label, onResize, onResizeEnd, onReset, value, min, max, className }: ResizerProps) {
  const startX = useRef<number | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    startX.current = e.clientX
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.dataset.dragging = 'true'
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return
    onResize(e.clientX - startX.current)
  }
  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return
    startX.current = null
    delete e.currentTarget.dataset.dragging
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    onResizeEnd()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onResize(e.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP)
      onResizeEnd()
    } else if (e.key === 'Home' && onReset) {
      e.preventDefault()
      onReset()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize touch-none select-none outline-none',
        'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors before:duration-(--dur-base) before:delay-100',
        'hover:before:bg-accent/60 data-[dragging=true]:before:bg-accent focus-visible:before:bg-accent/60',
        className,
      )}
    />
  )
}
