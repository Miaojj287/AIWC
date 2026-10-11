import { describe, expect, it } from 'vitest'
import { asCallId, asThreadId, asTurnId, newApprovalId, newStepId, type Event } from '@aiwc/protocol'
import { childEventBridge } from './childBridge'

const child = asThreadId('thr_child')
const parent = asThreadId('thr_parent')
const parentTurn = asTurnId('trn_parent')

const call = (risk: 'read' | 'write', callId: string): Event => ({
  type: 'tool.call',
  threadId: child,
  turnId: asTurnId('trn_child'),
  stepId: newStepId(),
  callId: asCallId(callId),
  toolName: 't',
  summary: 't',
  input: null,
  status: 'running',
  risk,
  startedAt: 0,
})

describe('childEventBridge', () => {
  it('re-tags approvals and side-effectful rows onto the parent turn, keeps reads hidden', () => {
    const out: Event[] = []
    const emit = childEventBridge((e) => out.push(e), { childId: child, parentId: parent, parentTurnId: parentTurn })
    emit(call('read', 'c_read'))
    emit(call('write', 'c_write'))
    emit({
      type: 'approval.requested',
      threadId: child,
      turnId: asTurnId('trn_child'),
      approvalId: newApprovalId(),
      callId: asCallId('c_read2'),
      toolName: 't',
      summary: 't',
      input: null,
      risk: 'send',
      canAllowAlways: false,
    })
    emit({ type: 'tool.progress', threadId: child, callId: asCallId('c_read2'), message: 'x' })
    const parentEvents = out.filter((e) => e.threadId === parent)
    expect(parentEvents.map((e) => e.type)).toEqual(['tool.call', 'approval.requested', 'tool.progress'])
    expect(parentEvents.every((e) => !('turnId' in e) || e.turnId === parentTurn)).toBe(true)
    // the originals still reach in-kernel listeners, except approvals (answered only through the parent)
    expect(out.filter((e) => e.threadId === child).map((e) => e.type)).toEqual([
      'tool.call',
      'tool.call',
      'tool.progress',
    ])
  })
})
