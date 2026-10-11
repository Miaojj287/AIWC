/**
 * Where the reader was in each conversation: switching threads (tabs, sidebar rows) and coming back returns to the
 * same place instead of the bottom. In memory for the app session — a restart opens conversations at their end.
 * A reader who was at the bottom is remembered as "at the bottom", so new output that arrived meanwhile is shown.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

interface Position {
  top: number
  atBottom: boolean
}

/** Conversations remembered at most (oldest forgotten first). */
const MAX_REMEMBERED = 50

const positions = new Map<string, Position>()

export function rememberScroll(key: string, position: Position): void {
  positions.delete(key)
  positions.set(key, position)
  if (positions.size > MAX_REMEMBERED) {
    const oldest = positions.keys().next().value
    if (oldest !== undefined) positions.delete(oldest)
  }
}

export function recalledScroll(key: string): Position | undefined {
  return positions.get(key)
}

/** Forget everything (tests). */
export function __resetScrollMemoryForTests(): void {
  positions.clear()
}

/**
 * Restores `key`'s remembered position once the transcript has content (`ready`), and records the position on every
 * scroll. `onRestored` runs when a mid-conversation position was restored, so the list stops following the stream.
 */
export function useScrollMemory(
  viewportRef: RefObject<HTMLElement | null>,
  key: string | undefined,
  ready: boolean,
  onRestored: () => void,
): (atBottom: boolean) => void {
  const restoredRef = useRef(false)
  useLayoutEffect(() => {
    if (!key || !ready || restoredRef.current) return
    restoredRef.current = true
    const saved = recalledScroll(key)
    const el = viewportRef.current
    if (!saved || saved.atBottom || !el) return
    el.scrollTop = saved.top
    onRestored()
  }, [key, ready, viewportRef, onRestored])
  return useCallback(
    (atBottom: boolean) => {
      const el = viewportRef.current
      // Nothing is recorded before the restore ran: the first layout pass would overwrite the saved place.
      if (!key || !el || !restoredRef.current) return
      rememberScroll(key, { top: el.scrollTop, atBottom })
    },
    [key, viewportRef],
  )
}
