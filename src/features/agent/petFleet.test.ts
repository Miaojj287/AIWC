import { describe, expect, it } from 'vitest'
import { asCallId, asThreadId, asTurnId, type ApprovalId } from '@aiwc/protocol'
import type { ApprovalRequest } from './model'
import { deriveFleet, type FleetInput } from './petFleet'
import type { QuestionRequest } from './turnSignals'

const id = asThreadId
const approval: ApprovalRequest = {
  approvalId: 'apr_1' as ApprovalId,
  callId: asCallId('c1'),
  turnId: asTurnId('turn_1'),
  toolName: 'send_message',
  summary: '发送消息',
  input: {},
  risk: 'send',
  canAllowAlways: false,
}
const question: QuestionRequest = {
  questionId: 'q1',
  callId: asCallId('c2'),
  turnId: asTurnId('turn_1'),
  question: '用哪个模板？',
  options: [],
  allowOther: true,
}
type View = FleetInput['views'][string]
const view = (patch: Partial<View> = {}): View => ({ isStreaming: false, pendingApprovals: [], ...patch })

const input = (patch: Partial<FleetInput> = {}): FleetInput => ({
  threads: [],
  views: {},
  marks: {},
  viewing: null,
  ...patch,
})

describe('deriveFleet', () => {
  it('counts running, waiting, done and failed threads once each', () => {
    const fleet = deriveFleet(
      input({
        threads: [id('a'), id('b'), id('c'), id('d'), id('e')].map((threadId) => ({ threadId })),
        views: {
          a: view({ isStreaming: true }),
          b: view({ isStreaming: true, pendingApprovals: [approval] }),
          c: view(),
        },
        // a running thread never also counts as done, even with an old mark
        marks: { a: 'unread', c: 'unread', d: 'unread', e: 'failed' },
      }),
    )
    expect(fleet).toMatchObject({ running: 1, waiting: 1, done: 2, failed: 1 })
    expect(fleet.targets).toEqual({ running: 'a', waiting: 'b', done: 'c', failed: 'e' })
  })

  it('treats an open question as waiting for the user', () => {
    const fleet = deriveFleet(
      input({
        threads: [{ threadId: id('q') }],
        views: { q: view({ isStreaming: true, pendingQuestions: [question] }) },
      }),
    )
    expect(fleet).toMatchObject({ running: 0, waiting: 1 })
  })

  it('never targets the thread already on screen, and prefers the most recent other one', () => {
    const fleet = deriveFleet(
      input({
        threads: [{ threadId: id('x') }, { threadId: id('y') }],
        views: { x: view({ isStreaming: true }), y: view({ isStreaming: true }) },
        viewing: id('x'),
      }),
    )
    expect(fleet.running).toBe(2)
    expect(fleet.targets.running).toBe('y')

    const alone = deriveFleet(
      input({ threads: [{ threadId: id('x') }], views: { x: view({ isStreaming: true }) }, viewing: id('x') }),
    )
    expect(alone.running).toBe(1)
    expect(alone.targets.running).toBeUndefined()
  })

  it('counts a live view outside the list (a scheduled run) but ignores marks of deleted threads', () => {
    const fleet = deriveFleet(
      input({
        threads: [],
        views: { cron: view({ isStreaming: true }) },
        marks: { gone: 'unread' },
      }),
    )
    expect(fleet).toMatchObject({ running: 1, done: 0 })
    expect(fleet.targets.running).toBe('cron')
  })

  it('passes the WeChat unread summary through', () => {
    const unread = { messages: 5, chats: 2, capped: false }
    expect(deriveFleet(input({ unread })).unread).toBe(unread)
  })
})
