/**
 * 引用到 Agent with a text selection in the chat stream: which messages the selection touches, so the quote also
 * carries them (the host injects their text into the turn, like quoting picked messages).
 */
import { MAX_QUOTED_MESSAGES } from '@aiwc/protocol'

/** Ids of the rendered messages (`data-message-id`) the current selection overlaps, in transcript order. */
export function selectedMessageIds(container: HTMLElement | null): string[] {
  if (!container || typeof document === 'undefined') return []
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return []
  const range = sel.getRangeAt(0)
  const ids: string[] = []
  for (const el of container.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const id = el.dataset.messageId
    if (id && range.intersectsNode(el) && !ids.includes(id)) ids.push(id)
    if (ids.length >= MAX_QUOTED_MESSAGES) break
  }
  return ids
}
