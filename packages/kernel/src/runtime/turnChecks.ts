/**
 * Automatic checks a Stop hook reports (a citation audit): recorded as `turn_check` items so the transcript shows
 * 「已核对 5 处引用 · 1 处不符，已重写」 live and after a reload. Display only — what the model must fix reaches it
 * as the hook's stop_hook fragment, never through these items.
 */
import {
  newItemId,
  TurnCheckSchema,
  type Event,
  type HistoryItem,
  type ThreadId,
  type TurnCheck,
  type TurnCheckItem,
  type TurnId,
} from '@aiwc/protocol'

export interface TurnCheckDeps {
  threadId: ThreadId
  turnId: TurnId
  record: (items: HistoryItem[]) => unknown
  emit: (event: Event) => void
  clock: () => number
}

/**
 * Records each well-formed check. A failed check's `action` is the turn's decision: the answer goes back to be
 * rewritten (`rewriting`), or no rewrite is left and the issues stand.
 */
export function recordTurnChecks(
  checks: readonly TurnCheck[] | undefined,
  rewriting: boolean,
  deps: TurnCheckDeps,
): void {
  for (const raw of checks ?? []) {
    const parsed = TurnCheckSchema.safeParse(raw)
    if (!parsed.success) continue
    const check: TurnCheck = {
      ...parsed.data,
      action: parsed.data.failed > 0 ? (rewriting ? 'rewrite' : 'kept') : 'none',
    }
    const item: TurnCheckItem = {
      type: 'turn_check',
      id: newItemId(),
      turnId: deps.turnId,
      createdAt: deps.clock(),
      check,
    }
    deps.record([item])
    deps.emit({ type: 'turn.check', threadId: deps.threadId, turnId: deps.turnId, itemId: item.id, check })
  }
}
