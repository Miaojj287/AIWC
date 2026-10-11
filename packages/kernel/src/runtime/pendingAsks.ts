/**
 * The approvals and `ask_user` questions still waiting for an answer, per thread, so a renderer that reloads mid-turn
 * (or a thread opened after the ask went out) can show the card again instead of a turn stuck on 等待确认. Built from
 * the kernel's own event stream: an ask is open from its `*.requested` until its `*.resolved` or the end of its turn.
 */
import type { PendingAskEvent, ThreadId, TurnId } from '@aiwc/protocol'
import type { Emitter } from './emitter'

type PendingAsk = PendingAskEvent

export interface PendingAsks {
  /** Open asks of the thread, oldest first. */
  forThread(threadId: ThreadId): PendingAsk[]
  dispose(): void
}

export function trackPendingAsks(on: Emitter['on']): PendingAsks {
  /** key `a:<approvalId>` / `q:<questionId>` → the request event */
  const open = new Map<string, PendingAsk>()
  const dropTurn = (threadId: ThreadId, turnId: TurnId): void => {
    for (const [key, ask] of open) if (ask.threadId === threadId && ask.turnId === turnId) open.delete(key)
  }
  const off = on((e) => {
    switch (e.type) {
      case 'approval.requested':
        open.set(`a:${e.approvalId}`, e)
        return
      case 'question.requested':
        open.set(`q:${e.questionId}`, e)
        return
      case 'approval.resolved':
        open.delete(`a:${e.approvalId}`)
        return
      case 'question.resolved':
        open.delete(`q:${e.questionId}`)
        return
      case 'turn.completed':
      case 'turn.aborted':
        dropTurn(e.threadId, e.turnId)
        return
      default:
        return
    }
  })
  return {
    forThread: (threadId) => [...open.values()].filter((ask) => ask.threadId === threadId),
    dispose() {
      off()
      open.clear()
    },
  }
}
