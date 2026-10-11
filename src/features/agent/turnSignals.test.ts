import { describe, expect, it } from 'vitest'
import type { CallId, Event, ItemId, ThreadId, TurnId } from '@aiwc/protocol'
import { createThreadView } from './model'
import { reduceEvents } from './reducer'

const threadId = 'thr_sig' as ThreadId
const turnId = 'trn_1' as TurnId
const base = { threadId, turnId }
const now = () => 1_000

const question: Event = {
  type: 'question.requested',
  ...base,
  questionId: 'qst_1',
  callId: 'cal_1' as CallId,
  question: '发给谁？',
  options: [{ label: '张三' }, { label: '李四', description: '同事' }],
  allowOther: true,
}

describe('turn signals', () => {
  it('keeps a question pending until it is answered or the turn ends', () => {
    const asked = reduceEvents(createThreadView(threadId), [question, question], { now })
    expect(asked.pendingQuestions).toHaveLength(1)
    expect(asked.pendingQuestions?.[0]).toMatchObject({ question: '发给谁？', allowOther: true })
    const answered = reduceEvents(
      asked,
      [{ type: 'question.resolved', threadId, questionId: 'qst_1', answer: { kind: 'dismissed' } }],
      { now },
    )
    expect(answered.pendingQuestions).toBeUndefined()
    const aborted = reduceEvents(asked, [{ type: 'turn.aborted', ...base, reason: 'interrupted' }], { now })
    expect(aborted.pendingQuestions).toBeUndefined()
  })

  it('shows 重新连接中 n/m, drops the failed partial reply, and clears once output flows again', () => {
    const itemId = 'itm_1' as ItemId
    const view = reduceEvents(
      createThreadView(threadId),
      [
        { type: 'turn.started', ...base, at: 1 },
        { type: 'text.start', ...base, itemId },
        { type: 'text.delta', ...base, itemId, delta: '半句' },
        { type: 'stream.retrying', ...base, attempt: 1, max: 3, reason: 'stalled', delayMs: 1000 },
      ],
      { now },
    )
    expect(view.turnSignal).toEqual({ kind: 'reconnecting', attempt: 1, max: 3, reason: 'stalled' })
    expect(view.items.some((it) => it.kind === 'assistant')).toBe(false)

    const resumed = reduceEvents(view, [{ type: 'text.delta', ...base, itemId: 'itm_2' as ItemId, delta: '完整' }], {
      now,
    })
    expect(resumed.turnSignal).toBeUndefined()
    expect(resumed.items.find((it) => it.kind === 'assistant')).toMatchObject({ text: '完整' })
  })

  it('a retry drops only the retried request, not an earlier step that only reasoned before calling tools', () => {
    const view = reduceEvents(
      createThreadView(threadId),
      [
        { type: 'turn.started', ...base, at: 1 },
        { type: 'reasoning.delta', ...base, itemId: 'itm_think' as ItemId, delta: '先查一下' },
        {
          type: 'tool.call',
          ...base,
          stepId: 'stp_1' as never,
          callId: 'call_1' as never,
          toolName: 'search',
          summary: '搜索',
          input: {},
          status: 'done',
          risk: 'read',
          startedAt: 2,
          durationMs: 1,
        },
        { type: 'text.start', ...base, itemId: 'itm_partial' as ItemId },
        { type: 'text.delta', ...base, itemId: 'itm_partial' as ItemId, delta: '半句' },
        { type: 'stream.retrying', ...base, attempt: 1, max: 3, reason: 'network', delayMs: 1000 },
      ],
      { now },
    )
    const assistants = view.items.filter((it) => it.kind === 'assistant')
    expect(assistants.map((it) => it.id)).toEqual(['itm_think'])
    expect(assistants[0]).toMatchObject({ reasoning: '先查一下', streaming: false })
  })

  it('shows 继续生成 until the turn ends', () => {
    const view = reduceEvents(createThreadView(threadId), [{ type: 'turn.continuing', ...base, attempt: 1, max: 2 }], {
      now,
    })
    expect(view.turnSignal).toEqual({ kind: 'continuing', attempt: 1, max: 2 })
    const done = reduceEvents(
      view,
      [
        {
          type: 'turn.completed',
          ...base,
          finalText: 'x',
          usage: { inputTokens: 0, outputTokens: 0 },
          steps: 2,
          at: 2,
        },
      ],
      { now },
    )
    expect(done.turnSignal).toBeUndefined()
  })
})
