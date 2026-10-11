/**
 * Folding of the kernel's turn signals into a thread view (pure; reducer.ts runs it after its own fold):
 * `ask_user` questions waiting for an answer, and the running turn's 「重新连接中 n/m」 / 继续生成 state. A retry drops
 * what the failed request had streamed (the kernel discards it too); the signal clears as soon as output flows
 * again or the turn ends.
 */
import type { CallId, Event, StreamRetryReason, TurnId, UserQuestionOption } from '@aiwc/protocol'
import type { ThreadItem, ThreadViewState } from './model'

export interface QuestionRequest {
  questionId: string
  callId: CallId
  turnId: TurnId
  question: string
  options: UserQuestionOption[]
  allowOther: boolean
}

export type TurnSignal =
  | { kind: 'reconnecting'; attempt: number; max: number; reason: StreamRetryReason }
  | { kind: 'continuing'; attempt: number; max: number }

export function reduceTurnSignals(state: ThreadViewState, e: Event): ThreadViewState {
  if (e.threadId !== state.threadId) return state
  switch (e.type) {
    case 'question.requested': {
      const pending = state.pendingQuestions ?? []
      if (pending.some((q) => q.questionId === e.questionId)) return state
      const request: QuestionRequest = {
        questionId: e.questionId,
        callId: e.callId,
        turnId: e.turnId,
        question: e.question,
        options: e.options,
        allowOther: e.allowOther,
      }
      return { ...state, pendingQuestions: [...pending, request] }
    }
    case 'question.resolved':
      return withoutQuestions(state, (q) => q.questionId === e.questionId)
    case 'stream.retrying':
      return {
        ...state,
        // The failed attempt's partial reply is gone from the kernel's history; it leaves the transcript too.
        items: withoutRetriedReply(state.items, e.turnId),
        turnSignal: { kind: 'reconnecting', attempt: e.attempt, max: e.max, reason: e.reason },
      }
    case 'turn.continuing':
      return { ...state, turnSignal: { kind: 'continuing', attempt: e.attempt, max: e.max } }
    case 'text.delta':
    case 'reasoning.delta':
    case 'tool.call':
      return state.turnSignal?.kind === 'reconnecting' ? { ...state, turnSignal: undefined } : state
    case 'turn.completed':
    case 'turn.aborted': {
      const next = withoutQuestions(state, (q) => q.turnId === e.turnId)
      return next.turnSignal ? { ...next, turnSignal: undefined } : next
    }
    default:
      return state
  }
}

/**
 * Drops the retried request's partial reply: the turn's streaming assistant items after its last tool row. An earlier
 * step's reply (a reasoning-only one never gets text.end) sits before that step's tools and stays.
 */
function withoutRetriedReply(items: ThreadItem[], turnId: TurnId): ThreadItem[] {
  let lastTools = -1
  items.forEach((it, i) => {
    if (it.kind === 'tools' && it.turnId === turnId) lastTools = i
  })
  const next = items.filter(
    (it, i) => !(i > lastTools && it.kind === 'assistant' && it.turnId === turnId && it.streaming),
  )
  return next.length === items.length ? items : next
}

function withoutQuestions(state: ThreadViewState, drop: (q: QuestionRequest) => boolean): ThreadViewState {
  const pending = state.pendingQuestions
  if (!pending?.some(drop)) return state
  const rest = pending.filter((q) => !drop(q))
  return { ...state, pendingQuestions: rest.length ? rest : undefined }
}
