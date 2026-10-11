import { describe, expect, it } from 'vitest'
import { asCallId, asThreadId, type Event, type ToolContext, type TurnId, type StepId } from '@aiwc/protocol'
import type { ToolDispatchContext } from '../ports'
import { askUserTool, bindAskUser, createQuestionGate, NO_USER_TO_ASK_MESSAGE } from './questions'

const threadId = asThreadId('thr_q')

function dispatchCtx(patch: Partial<ToolDispatchContext> = {}): {
  ctx: ToolDispatchContext
  events: Event[]
  waits: string[]
} {
  const events: Event[] = []
  const waits: string[] = []
  const ctx: ToolDispatchContext = {
    threadId,
    turnId: 'trn_1' as TurnId,
    stepId: 'stp_1' as StepId,
    channel: 'desktop',
    profile: 'desktop-chat',
    depth: 0,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    onApprovalWait: () => {
      waits.push('pause')
      return () => waits.push('resume')
    },
    ...patch,
  }
  return { ctx, events, waits }
}

describe('ask_user', () => {
  it('asks through the gate, pauses the turn budget, and reports the answer', async () => {
    const gate = createQuestionGate()
    const { ctx, events, waits } = dispatchCtx()
    const ask = bindAskUser(gate, ctx, asCallId('cal_1'), ctx.signal)!
    const pending = ask({ question: '发给谁？', options: [{ label: '张三' }, { label: '李四' }], allowOther: true })
    const requested = events[0]
    expect(requested).toMatchObject({
      type: 'question.requested',
      question: '发给谁？',
      callId: 'cal_1',
      allowOther: true,
    })
    const questionId = requested?.type === 'question.requested' ? requested.questionId : ''
    // another thread cannot answer it
    expect(gate.resolve(questionId, { kind: 'option', index: 0, label: '张三' }, asThreadId('thr_other'))).toBe(false)
    expect(gate.resolve(questionId, { kind: 'option', index: 1, label: '李四' }, threadId)).toBe(true)
    expect(await pending).toEqual({ kind: 'option', index: 1, label: '李四' })
    expect(events[1]).toMatchObject({ type: 'question.resolved', questionId, answer: { kind: 'option', index: 1 } })
    expect(waits).toEqual(['pause', 'resume'])
  })

  it('settles as dismissed when the turn is interrupted', async () => {
    const gate = createQuestionGate()
    const controller = new AbortController()
    const { ctx } = dispatchCtx({ signal: controller.signal })
    const pending = bindAskUser(gate, ctx, asCallId('cal_2'), controller.signal)!({
      question: 'q',
      options: [{ label: 'a' }, { label: 'b' }],
      allowOther: false,
    })
    controller.abort()
    expect(await pending).toEqual({ kind: 'dismissed' })
  })

  it('is unavailable where nobody can answer, and the tool then fails fast', async () => {
    const gate = createQuestionGate()
    expect(
      bindAskUser(gate, dispatchCtx({ channel: 'cron' }).ctx, asCallId('c'), new AbortController().signal),
    ).toBeUndefined()
    expect(
      bindAskUser(gate, dispatchCtx({ depth: 1 }).ctx, asCallId('c'), new AbortController().signal),
    ).toBeUndefined()

    const tool = askUserTool()
    const base = {
      threadId,
      turnId: 'trn_1' as TurnId,
      stepId: 'stp_1' as StepId,
      callId: asCallId('c'),
      channel: 'cron',
      profile: 'cron',
      signal: new AbortController().signal,
      services: {},
      progress: () => {},
      depth: 0,
    } satisfies ToolContext
    const input = tool.inputSchema.parse({ question: 'q', options: [{ label: 'a' }, { label: 'b' }] })
    expect(await tool.execute(input, base)).toEqual({ content: NO_USER_TO_ASK_MESSAGE, isError: true })

    const answered = await tool.execute(input, { ...base, askUser: async () => ({ kind: 'other', text: '都行' }) })
    expect(answered.content).toContain('都行')
    expect(tool.inputSchema.safeParse({ question: 'q', options: [{ label: 'only one' }] }).success).toBe(false)
  })
})
