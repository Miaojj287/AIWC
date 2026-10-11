/**
 * Turn signals: what a running turn tells the user besides text and tool rows — a question the agent asks
 * (`ask_user`, answered with a numbered option or free text), a stalled or failed model stream being retried
 * (「重新连接中 n/m」), and an answer cut off by the output limit being continued. Kept apart from ops.ts so the
 * core wire contract stays small; ops.ts unions these into Event / Op.
 */
import { nanoid } from 'nanoid'
import type { CallId, ThreadId, TurnId } from './ids'

/** Options offered by one `ask_user` call (besides 其他, which is free text). */
export const QUESTION_MIN_OPTIONS = 2
export const QUESTION_MAX_OPTIONS = 5

export const newQuestionId = (): string => `qst_${nanoid(10)}`

export interface UserQuestionOption {
  label: string
  /** One short line under the label. */
  description?: string
}

/** How the user answered; `dismissed` = 拒绝回答 (Esc), the agent then proceeds on its own judgement. */
export type QuestionAnswer =
  { kind: 'option'; index: number; label: string } | { kind: 'other'; text: string } | { kind: 'dismissed' }

/** Why a model request is being sent again inside the same step. */
export type StreamRetryReason = 'stalled' | 'rate_limit' | 'network' | 'server'

export type TurnSignalEvent =
  | {
      type: 'question.requested'
      threadId: ThreadId
      turnId: TurnId
      questionId: string
      callId: CallId
      question: string
      options: UserQuestionOption[]
      /** Offer 其他 (free text). */
      allowOther: boolean
    }
  | { type: 'question.resolved'; threadId: ThreadId; questionId: string; answer: QuestionAnswer }
  | {
      /** The step's model request is being retried: attempt n of max, after `delayMs`. */
      type: 'stream.retrying'
      threadId: ThreadId
      turnId: TurnId
      attempt: number
      max: number
      reason: StreamRetryReason
      delayMs: number
    }
  | {
      /** The answer hit the output limit; the next step continues it (n of max). */
      type: 'turn.continuing'
      threadId: ThreadId
      turnId: TurnId
      attempt: number
      max: number
    }

export type TurnSignalOp = { type: 'question.answer'; threadId: ThreadId; questionId: string; answer: QuestionAnswer }

/** The text the model reads as the `ask_user` result (prompt-side wording, not UI copy). */
export function questionAnswerText(answer: QuestionAnswer): string {
  switch (answer.kind) {
    case 'option':
      return `用户选择了：${answer.label}`
    case 'other':
      return `用户回答：${answer.text}`
    case 'dismissed':
      return '用户没有回答这个问题。请按最合理的理解继续，并在回复里说明你做的假设。'
  }
}
