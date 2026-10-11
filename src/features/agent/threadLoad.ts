/**
 * A thread view rebuilt from agent:getThread, merged with what only the live event stream knows (agentStore.loadThread
 * keeps the fetch and the store writes; the merge is here so the store stays small). Live-only state that arrived while
 * loading is kept — the turn's working state, approvals, questions, the 重新连接中 / 继续生成 signal, unsent inputs —
 * and the asks the kernel still holds open are folded in as their request events, so a renderer that reloads mid-turn
 * shows the approval or question card again instead of a turn stuck on 等待确认.
 */
import type { HistoryItem, PendingAskEvent, ThreadId } from '@aiwc/protocol'
import { viewFromHistory } from './historyItems'
import type { ThreadViewState } from './model'
import { reduceEvent } from './reducer'

export interface LoadedThread {
  items: HistoryItem[]
  running?: boolean
  pendingAsks?: PendingAskEvent[]
}

export function mergeLoadedView(
  threadId: ThreadId,
  loaded: LoadedThread,
  live: ThreadViewState | undefined,
): ThreadViewState {
  const view = viewFromHistory(threadId, loaded.items)
  const merged: ThreadViewState = live
    ? {
        ...view,
        usage: live.usage ?? view.usage,
        isStreaming: live.isStreaming || Boolean(loaded.running),
        currentTurnId: live.currentTurnId,
        turnStartedAt: live.turnStartedAt,
        pendingApprovals: live.pendingApprovals,
        pendingQuestions: live.pendingQuestions,
        turnSignal: live.turnSignal,
        pendingInputs: live.pendingInputs,
        focusItemId: live.focusItemId,
      }
    : { ...view, isStreaming: Boolean(loaded.running) }
  // the reducer skips asks already shown (same approval / question id)
  return (loaded.pendingAsks ?? []).reduce((state, ask) => reduceEvent(state, ask), merged)
}
