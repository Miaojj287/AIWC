import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { cn } from './cn'
import type { IconComponent } from './icon'

/** Gap between the selection's top edge and the floating action. */
const OFFSET_PX = 6
/** Keeps the action inside the window. */
const EDGE_PX = 8
/** Height of the sm button (h26) plus its 1px ring; used to flip below a selection at the top edge. */
const ACTION_HEIGHT_PX = 28

export interface SelectionActionProps {
  /** Only selections that lie entirely inside this element show the action. */
  containerRef: RefObject<HTMLElement | null>
  label: string
  icon?: IconComponent
  /** Receives the selected text; the selection is cleared afterwards. */
  onAction: (text: string) => void
  className?: string
}

interface Anchor {
  x: number
  top: number
  bottom: number
  text: string
}

/** The selection inside `container`, when there is a non-blank one. */
export function selectionWithin(container: HTMLElement | null): { text: string; rect: DOMRect } | undefined {
  if (!container || typeof document === 'undefined') return undefined
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined
  const range = sel.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return undefined
  const text = sel.toString()
  if (!text.trim()) return undefined
  // Ranges have no layout outside a real engine (jsdom): anchor on the container then.
  const rect =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : container.getBoundingClientRect()
  return { text, rect }
}

/**
 * A small floating action over a text selection (引用到 Agent): appears once the pointer or keyboard has finished
 * selecting inside `containerRef`, hides when the selection collapses, the page scrolls or the window resizes.
 * Pressing it keeps the selection (mousedown is swallowed) until `onAction` has read it.
 */
export function SelectionAction({ containerRef, label, icon, onAction, className }: SelectionActionProps) {
  const [anchor, setAnchor] = useState<Anchor | undefined>(undefined)

  useEffect(() => {
    if (typeof document === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = () => {
      // Read once the browser has settled the selection for this pointer / key event.
      clearTimeout(timer)
      timer = setTimeout(() => {
        const found = selectionWithin(containerRef.current)
        setAnchor(
          found
            ? {
                x: found.rect.left + found.rect.width / 2,
                top: found.rect.top,
                bottom: found.rect.bottom,
                text: found.text,
              }
            : undefined,
        )
      }, 0)
    }
    const hideIfCollapsed = () => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed) setAnchor(undefined)
    }
    const hide = () => setAnchor(undefined)
    document.addEventListener('mouseup', show)
    document.addEventListener('keyup', show)
    document.addEventListener('selectionchange', hideIfCollapsed)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseup', show)
      document.removeEventListener('keyup', show)
      document.removeEventListener('selectionchange', hideIfCollapsed)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [containerRef])

  if (!anchor || typeof document === 'undefined') return null
  const above = anchor.top - OFFSET_PX - ACTION_HEIGHT_PX >= EDGE_PX
  const top = above ? anchor.top - OFFSET_PX - ACTION_HEIGHT_PX : anchor.bottom + OFFSET_PX
  const left = Math.min(Math.max(anchor.x, EDGE_PX), window.innerWidth - EDGE_PX)
  return createPortal(
    <div
      className={cn('fixed z-50 -translate-x-1/2 rounded-control bg-overlay shadow-overlay', className)}
      style={{ top, left }}
      data-selection-action=""
    >
      <Button
        size="sm"
        variant="outline"
        icon={icon}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onAction(anchor.text)
          document.getSelection()?.removeAllRanges()
          setAnchor(undefined)
        }}
      >
        {label}
      </Button>
    </div>,
    document.body,
  )
}
