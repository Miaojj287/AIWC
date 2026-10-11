import { describe, expect, it } from 'vitest'
import type { AgentChange } from '@aiwc/protocol'
import { changesByTurn, undoUnavailableReason } from './changesModel'

const change = (patch: Partial<AgentChange>): AgentChange => ({
  id: 'chg_1',
  threadId: 'thr_1' as never,
  turnId: 'trn_1' as never,
  callId: 'cal_1' as never,
  toolName: 'shell',
  kind: 'file',
  action: 'created',
  target: 'a.md',
  at: 0,
  undoable: true,
  ...patch,
})

describe('changes model', () => {
  it('groups changes under their turn in order', () => {
    const map = changesByTurn([change({ id: 'a' }), change({ id: 'b', turnId: 'trn_2' as never }), change({ id: 'c' })])
    expect(map.get('trn_1' as never)?.map((c) => c.id)).toEqual(['a', 'c'])
    expect(map.get('trn_2' as never)?.map((c) => c.id)).toEqual(['b'])
  })

  it('explains why a change cannot be undone', () => {
    expect(undoUnavailableReason(change({}))).toBeUndefined()
    expect(undoUnavailableReason(change({ kind: 'message', action: 'sent', undoable: false }))).toBe(
      'agent.changes.notUndoable',
    )
    expect(undoUnavailableReason(change({ undoable: false }))).toBe('agent.changes.tooLarge')
  })
})
