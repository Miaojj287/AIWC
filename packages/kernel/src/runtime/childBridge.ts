/**
 * What a child run (delegate / workflow step) shows in the conversation that started it. A child is never a listed
 * conversation, so the renderer drops its events — except what the user must see there: its approval requests (they
 * are answered in the parent's composer slot, see ApprovalGate.alias) and its side-effectful tool rows, re-tagged onto
 * the parent's thread and turn. Reads stay hidden; the child-tagged originals still go out for in-kernel listeners.
 */
import type { CallId, Event, ThreadId, TurnId } from '@aiwc/protocol'

export interface ChildBridgeIds {
  childId: ThreadId
  parentId: ThreadId
  /** The parent turn the child runs inside (the tool call's turn); rows land in it. */
  parentTurnId?: TurnId
}

export function childEventBridge(emit: (event: Event) => void, ids: ChildBridgeIds): (event: Event) => void {
  const forwarded = new Set<CallId>()
  const retag = <E extends Event>(event: E): E => {
    const copy = { ...event, threadId: ids.parentId }
    if ('turnId' in copy && ids.parentTurnId) (copy as { turnId?: TurnId }).turnId = ids.parentTurnId
    return copy
  }
  return (event) => {
    if (event.threadId !== ids.childId) {
      emit(event)
      return
    }
    switch (event.type) {
      case 'approval.requested':
        forwarded.add(event.callId)
        emit(retag(event))
        return
      case 'approval.resolved':
        emit(retag(event))
        return
      case 'tool.call':
        emit(event)
        if (event.risk !== 'read' || forwarded.has(event.callId)) {
          forwarded.add(event.callId)
          emit(retag(event))
        }
        return
      case 'tool.progress':
        emit(event)
        if (forwarded.has(event.callId)) emit(retag(event))
        return
      default:
        emit(event)
    }
  }
}
