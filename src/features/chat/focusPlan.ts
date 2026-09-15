/**
 * What a chat tab does with a "focus this message" request that carries only a message id (Agent
 * citations, 查看原消息 in auto-reply records and the reply desk).
 *
 * The id alone is not enough to load a window around the message — the substrate pages by seq — so
 * an unloaded message is looked up first and the jump uses its real anchor. Guessing seq 0 instead
 * loads the chat's OLDEST messages around the target, which is what the tab used to do.
 */
import type { MessageAnchor, WxMessage } from '@aiwc/protocol'

export type FocusPlan =
  /** Already in the loaded window: just scroll to it. */
  | { kind: 'focus'; id: string }
  /** Load the window around it. */
  | { kind: 'jump'; anchor: MessageAnchor }
  /** The tab's filters would hide it: clear them, then jump. */
  | { kind: 'jump-unfiltered'; anchor: MessageAnchor }
  /** Not in the local index (recalled, not synced yet, or a bad citation). */
  | { kind: 'missing' }

export interface FocusPlanDeps {
  loaded(id: string): WxMessage | undefined
  fetch(id: string): Promise<WxMessage | undefined>
  filtered(): boolean
}

export async function planFocus(id: string, deps: FocusPlanDeps): Promise<FocusPlan> {
  if (deps.loaded(id)) return { kind: 'focus', id }
  let message: WxMessage | undefined
  try {
    message = await deps.fetch(id)
  } catch {
    message = undefined
  }
  if (!message) return { kind: 'missing' }
  // It may have arrived with a page that loaded while we were looking it up.
  if (deps.loaded(message.id)) return { kind: 'focus', id: message.id }
  return deps.filtered()
    ? { kind: 'jump-unfiltered', anchor: message.anchor }
    : { kind: 'jump', anchor: message.anchor }
}
