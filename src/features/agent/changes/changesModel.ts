/**
 * 本轮改动: grouping a thread's change journal by turn, and what each row says. Pure (no React, no bridge).
 */
import type { AgentChange, AgentChangeKind, TurnId, UndoChangeResult } from '@aiwc/protocol'
import type { MessageKey } from '@/i18n'

export function changesByTurn(changes: readonly AgentChange[]): ReadonlyMap<TurnId, AgentChange[]> {
  const map = new Map<TurnId, AgentChange[]>()
  for (const change of changes) {
    const list = map.get(change.turnId)
    if (list) list.push(change)
    else map.set(change.turnId, [change])
  }
  return map
}

export const CHANGE_KIND_LABEL: Record<AgentChangeKind, MessageKey> = {
  file: 'agent.changes.kind.file',
  memory: 'agent.changes.kind.memory',
  skill: 'agent.changes.kind.skill',
  message: 'agent.changes.kind.message',
}

export const CHANGE_ACTION_LABEL: Record<AgentChange['action'], MessageKey> = {
  created: 'agent.changes.action.created',
  modified: 'agent.changes.action.modified',
  deleted: 'agent.changes.action.deleted',
  added: 'agent.changes.action.added',
  removed: 'agent.changes.action.removed',
  sent: 'agent.changes.action.sent',
}

type UndoFailure = Extract<UndoChangeResult, { ok: false }>['reason']

export const UNDO_FAILURE: Record<UndoFailure, MessageKey> = {
  conflict: 'agent.changes.undoFailed.conflict',
  already_undone: 'agent.changes.undoFailed.already_undone',
  not_found: 'agent.changes.undoFailed.not_found',
  not_undoable: 'agent.changes.undoFailed.not_undoable',
  failed: 'agent.changes.undoFailed.failed',
}

/** Why a row offers no 撤销 (tooltip on the disabled button); undefined when it can be undone. */
export function undoUnavailableReason(change: AgentChange): MessageKey | undefined {
  if (change.undoneAt !== undefined || change.undoable) return undefined
  return change.kind === 'message' ? 'agent.changes.notUndoable' : 'agent.changes.tooLarge'
}
