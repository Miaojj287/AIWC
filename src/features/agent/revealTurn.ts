/**
 * Jumping to a search hit inside a transcript: once the timeline holds the item, scroll its turn into view and light
 * it for a moment (瞬间点亮、淡出, CLAUDE.md §13 — the chat tab's jump uses the same timing). Used by MessageList.
 */
import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { TimelineEntry } from './turnSegments'

/** How long a revealed turn stays lit before it fades. */
export const FOCUS_FLASH_MS = 1800

/** The segment that holds this item (as its prompt or in its body). */
export function segmentKeyOf(timeline: readonly TimelineEntry[], itemId: string): string | undefined {
  for (const entry of timeline) {
    if (entry.kind !== 'segment') continue
    const { segment } = entry
    if (segment.user?.id === itemId || segment.body.some((it) => it.id === itemId)) return segment.key
  }
  return undefined
}

export interface RevealTurnInput {
  viewportRef: RefObject<HTMLDivElement | null>
  timeline: readonly TimelineEntry[]
  focusItemId: string | undefined
  /** History still loading: an item not found yet may still arrive. */
  loading: boolean
  /** The request is done (found, or not in this thread at all). */
  onHandled?: () => void
  /** The list stops following the stream so the reader stays at the revealed turn. */
  onDetach: () => void
}

/** Returns the key of the turn currently lit. */
export function useRevealTurn({ viewportRef, timeline, focusItemId, loading, onHandled, onDetach }: RevealTurnInput) {
  const [flashKey, setFlashKey] = useState<string | undefined>(undefined)
  const handled = useEffectEvent(() => onHandled?.())
  const detach = useEffectEvent(() => onDetach())
  useEffect(() => {
    if (!focusItemId) return
    const key = segmentKeyOf(timeline, focusItemId)
    if (!key) {
      if (!loading) handled()
      return
    }
    const target = [...(viewportRef.current?.querySelectorAll<HTMLElement>('[data-turn]') ?? [])].find(
      (el) => el.dataset.turn === key,
    )
    target?.scrollIntoView?.({ block: 'start' })
    detach()
    setFlashKey(key)
    handled()
  }, [focusItemId, timeline, loading, viewportRef])
  useEffect(() => {
    if (!flashKey) return
    const timer = setTimeout(() => setFlashKey(undefined), FOCUS_FLASH_MS)
    return () => clearTimeout(timer)
  }, [flashKey])
  return flashKey
}
