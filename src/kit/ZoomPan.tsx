/**
 * ZoomPan — the one viewer for anything worth looking at closely (chat images, the file tab, images and Mermaid
 * diagrams in Agent replies): the wheel or a trackpad pinch zooms around the pointer, a two-finger touch pinch
 * zooms, dragging pans, a double-click resets, and with focus + / − / 0 zoom in, out and back. A small toolbar
 * (−, the level, +, reset) sits at the bottom. Content starts fitted by its own CSS; zoom is relative to that.
 */
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from './cn'
import { IconButton } from './IconButton'
import {
  panBy,
  wheelFactor,
  ZOOM_IDENTITY,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  zoomAt,
  zoomPercent,
  type ZoomPanState,
} from './zoomMath'

export interface ZoomPanProps {
  children: ReactNode
  /** Accessible name of the viewer (the image's alt text, the diagram's title). */
  label: string
  className?: string
  /** Hide the − / level / + / reset toolbar (the gestures and keys still work). */
  hideToolbar?: boolean
}

type Point = { x: number; y: number }

export function ZoomPan({ children, label, className, hideToolbar = false }: ZoomPanProps) {
  const t = useT()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ZoomPanState>(ZOOM_IDENTITY)
  const pointers = useRef(new Map<number, Point>())
  const pinchRef = useRef<{ distance: number } | undefined>(undefined)

  const local = (clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }
  const centre = (): Point => {
    const el = viewportRef.current
    return { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 }
  }

  // React's wheel listener is passive: preventDefault (stop the page scrolling / the browser zooming) needs our own.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      setView((v) => zoomAt(v, wheelFactor(e.deltaY, e.ctrlKey), point))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY))
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) }
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId)
    if (!previous) return
    const next = local(e.clientX, e.clientY)
    pointers.current.set(e.pointerId, next)
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const factor = pinchRef.current.distance > 0 ? distance / pinchRef.current.distance : 1
      pinchRef.current = { distance }
      setView((v) => zoomAt(v, factor, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }))
      return
    }
    setView((v) => panBy(v, next.x - previous.x, next.y - previous.y))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchRef.current = undefined
  }

  const zoomBy = (factor: number) => setView((v) => zoomAt(v, factor, centre()))
  const reset = () => setView(ZOOM_IDENTITY)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP)
    else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP)
    else if (e.key === '0') reset()
    else return
    e.preventDefault()
  }

  const moved = view.scale !== 1 || view.x !== 0 || view.y !== 0
  return (
    <div className={cn('relative flex min-h-0 min-w-0 overflow-hidden', className)}>
      <div
        ref={viewportRef}
        role="group"
        aria-label={label}
        aria-roledescription={t('kit.zoomPan.roleDescription')}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        className="flex min-h-0 min-w-0 flex-1 cursor-grab touch-none select-none items-center justify-center overflow-hidden outline-none active:cursor-grabbing"
      >
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
          }}
          data-zoom={zoomPercent(view)}
        >
          {children}
        </div>
      </div>
      {hideToolbar ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-control border border-line-8 bg-overlay p-0.5 shadow-overlay">
            <IconButton
              size="sm"
              icon={Minus}
              label={t('kit.zoomPan.zoomOut')}
              disabled={view.scale <= ZOOM_MIN}
              disabledReason={t('kit.zoomPan.atMin')}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            />
            <span aria-live="polite" className="min-w-10 text-center font-latin text-micro tabular-nums text-fg-2">
              {zoomPercent(view)}%
            </span>
            <IconButton
              size="sm"
              icon={Plus}
              label={t('kit.zoomPan.zoomIn')}
              disabled={view.scale >= ZOOM_MAX}
              disabledReason={t('kit.zoomPan.atMax')}
              onClick={() => zoomBy(ZOOM_STEP)}
            />
            <IconButton
              size="sm"
              icon={RotateCcw}
              label={t('kit.zoomPan.reset')}
              disabled={!moved}
              disabledReason={t('kit.zoomPan.atReset')}
              onClick={reset}
            />
          </div>
        </div>
      )}
    </div>
  )
}
