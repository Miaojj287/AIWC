import { describe, expect, it } from 'vitest'
import type { ApprovalId, CallId, Event, ThreadId, TurnId } from '@aiwc/protocol'
import { createEmitter } from './emitter'
import { trackPendingAsks } from './pendingAsks'

const threadId = 'thr_p' as ThreadId
const turnId = 'trn_p' as TurnId
const approval = (id: string, turn = turnId): Event => ({
  type: 'approval.requested',
  threadId,
  turnId: turn,
  approvalId: id as ApprovalId,
  callId: `cal_${id}` as CallId,
  toolName: 'write',
  summary: 's',
  input: null,
  risk: 'write',
  canAllowAlways: true,
})

describe('trackPendingAsks', () => {
  it('keeps an ask open until it is answered or its turn ends', () => {
    const emitter = createEmitter()
    const asks = trackPendingAsks(emitter.on)
    emitter.emit(approval('a1'))
    emitter.emit(approval('a2'))
    emitter.emit({
      type: 'question.requested',
      threadId,
      turnId,
      questionId: 'q1',
      callId: 'cal_q' as CallId,
      question: '?',
      options: [],
      allowOther: false,
    })
    expect(asks.forThread(threadId)).toHaveLength(3)
    expect(asks.forThread('thr_other' as ThreadId)).toEqual([])
    emitter.emit({ type: 'approval.resolved', threadId, approvalId: 'a1' as ApprovalId, decision: 'allow_once' })
    emitter.emit({ type: 'question.resolved', threadId, questionId: 'q1', answer: { kind: 'dismissed' } as never })
    expect(asks.forThread(threadId).map((e) => e.type === 'approval.requested' && e.approvalId)).toEqual(['a2'])
    emitter.emit({ type: 'turn.aborted', threadId, turnId, reason: 'interrupted' })
    expect(asks.forThread(threadId)).toEqual([])
    asks.dispose()
    emitter.emit(approval('a3'))
    expect(asks.forThread(threadId)).toEqual([])
  })
})
