/**
 * Forking a thread at a turn (从这一轮分出新会话): which items the new thread starts with. Pure, so the boundary rules
 * are tested without a store.
 */
import type { HistoryItem, ItemId, TurnId } from '@aiwc/protocol'

/** Why a fork point was refused (stable codes; the renderer words them). */
export type ForkRefusal = 'fork_target_missing' | 'fork_turn_running'

const turnOf = (item: HistoryItem): TurnId | null | undefined => ('turnId' in item ? item.turnId : undefined)

/**
 * The live history up to and including the turn that holds `throughItemId`: everything before that turn, the turn
 * itself (prompt, steers, work, answer), and nothing recorded after its last item. Items keep their ids — they are
 * unique per thread, and the new thread is a separate rollout.
 */
export function forkItems(
  items: readonly HistoryItem[],
  throughItemId: ItemId,
  runningTurnId?: TurnId,
): { ok: true; items: HistoryItem[] } | { ok: false; code: ForkRefusal } {
  const at = items.findIndex((it) => it.id === throughItemId)
  if (at < 0) return { ok: false, code: 'fork_target_missing' }
  const turnId = turnOf(items[at]!)
  if (!turnId) return { ok: true, items: items.slice(0, at + 1) }
  if (turnId === runningTurnId) return { ok: false, code: 'fork_turn_running' }
  let end = at
  for (let i = at + 1; i < items.length; i++) if (turnOf(items[i]!) === turnId) end = i
  return { ok: true, items: items.slice(0, end + 1) }
}
