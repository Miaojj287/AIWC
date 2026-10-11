/**
 * Frame clock for one sprite. Drives uneven per-frame durations (which CSS steps() cannot) and
 * one-shot plays: `repeat` cycles then `onDone`. With `playing` false the first frame stays put —
 * that is also the reduced-motion rendering, a still pose that still shows the state. The clock pauses while the
 * document is hidden and picks up from the same frame when it is shown again.
 */
import { useEffect, useRef, useState } from 'react'
import { PET_ANIMATIONS, type PetAnimationId } from './spriteSpec'

export interface SpriteClockOptions {
  playing: boolean
  /** Cycles to play before calling onDone; omit to loop forever. */
  repeat?: number
  onDone?: () => void
  /** Change to restart the same animation from its first frame. */
  restartKey?: unknown
}

export function useSpriteFrame(
  animation: PetAnimationId,
  { playing, repeat, onDone, restartKey }: SpriteClockOptions,
): number {
  const [frame, setFrame] = useState(0)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    setFrame(0)
    if (!playing) return
    const durations = PET_ANIMATIONS[animation].durations
    let index = 0
    let cycles = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      // A hidden window shows nothing: hold the current frame instead of waking the renderer several times a second.
      if (document.hidden) return
      timer = setTimeout(() => {
        index += 1
        if (index >= durations.length) {
          cycles += 1
          if (repeat !== undefined && cycles >= repeat) {
            done.current?.()
            return
          }
          index = 0
        }
        setFrame(index)
        tick()
      }, durations[index])
    }
    tick()
    const onVisibility = () => {
      clearTimeout(timer)
      tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(timer)
    }
  }, [animation, playing, repeat, restartKey])

  return frame
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** OS-level "reduce motion"; pets then hold a still pose. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    try {
      const mq = matchMedia(REDUCED_MOTION)
      const onChange = () => setReduced(mq.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      return undefined
    }
  }, [])
  return reduced
}
