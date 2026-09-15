/**
 * PetSprite — one frame of a Codex Pets sheet, scaled. The 192×208 cell is cropped at its natural
 * size and then scaled with a transform, so neighbouring frames never bleed in at fractional sizes.
 */
import { PawPrint } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { PetSpriteVersion } from '@aiwc/protocol'
import { cn, ICON_STROKE } from '@/kit'
import { animationFor, frameOffset, scaledFrame, sheetSize, type PetAnimationId } from './spriteSpec'
import { useSpriteFrame } from './useSpriteFrame'

export interface PetSpriteProps {
  src: string
  version: PetSpriteVersion
  animation?: PetAnimationId
  /** 1 = 192×208. */
  scale: number
  /** false = hold the first frame of the animation. */
  playing?: boolean
  repeat?: number
  onDone?: () => void
  restartKey?: unknown
  /** Accessible name; omit for decorative sprites. */
  label?: string
  className?: string
}

type LoadState = 'loading' | 'ready' | 'error'

/** Preload so a missing / broken sheet shows a placeholder instead of an empty box. */
function useImageState(src: string): LoadState {
  const [state, setState] = useState<LoadState>('loading')
  useEffect(() => {
    setState('loading')
    if (typeof Image === 'undefined') return
    const img = new Image()
    let alive = true
    img.onload = () => alive && setState('ready')
    img.onerror = () => alive && setState('error')
    img.src = src
    return () => {
      alive = false
    }
  }, [src])
  return state
}

export function PetSprite({
  src,
  version,
  animation = 'idle',
  scale,
  playing = true,
  repeat,
  onDone,
  restartKey,
  label,
  className,
}: PetSpriteProps) {
  const id = animationFor(animation, version)
  const frame = useSpriteFrame(id, { playing, repeat, onDone, restartKey })
  const load = useImageState(src)
  const box = scaledFrame(scale)
  const sheet = sheetSize(version)
  const { x, y } = frameOffset(id, frame)

  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true }
  return (
    <span
      {...a11y}
      data-animation={id}
      data-frame={frame}
      className={cn('relative inline-block shrink-0 overflow-hidden', className)}
      style={{ width: box.width, height: box.height }}
    >
      {load === 'error' ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-item bg-line-6 text-fg-3">
          <PawPrint size={Math.max(12, Math.round(box.width * 0.32))} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
      ) : (
        <span
          aria-hidden
          className="absolute left-0 top-0 block origin-top-left bg-no-repeat"
          style={
            {
              width: 192,
              height: 208,
              backgroundImage: `url("${src.replace(/"/g, '%22')}")`,
              backgroundSize: `${sheet.width}px ${sheet.height}px`,
              backgroundPosition: `${x}px ${y}px`,
              transform: `scale(${scale})`,
            } satisfies CSSProperties
          }
        />
      )}
    </span>
  )
}
