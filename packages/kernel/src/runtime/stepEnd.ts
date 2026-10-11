/**
 * How a step that ended without an error is judged before the turn moves on: a reply cut off by the output limit is
 * continued (at most MAX_LENGTH_CONTINUATIONS times, then an error card), a reply withheld by the provider's content
 * filter or an empty reply ends the turn with an error card instead of passing for a finished answer. Steps that call
 * tools are never judged here — the tool results continue the turn anyway.
 */
import type { ContextFragment, FinishReason } from '@aiwc/protocol'
import { createFragment } from './context/fragments/base'

/** Times one turn continues an answer cut off by the output limit before giving up with an error card. */
export const MAX_LENGTH_CONTINUATIONS = 2
const CONTINUATION_TOKEN_CAP = 200

export type TurnEndError = {
  code: 'content_filter' | 'empty_response' | 'output_truncated'
  message: string
  retryable: boolean
}

export type StepVerdict = { kind: 'ok' } | { kind: 'continue' } | { kind: 'fail'; error: TurnEndError }

export interface StepEndInput {
  text: string
  toolCalls: readonly unknown[]
  finish: FinishReason
}

/**
 * @param continuations length continuations already used in this turn
 * @param answerSoFar the turn's answer before this step (an earlier step's text counts as an answer)
 * @param canContinue false when the turn has no step left for a continuation (step cap): a cut-off answer then
 *   fails with the truncation card instead of passing for a finished one
 */
export function judgeStepEnd(
  outcome: StepEndInput,
  continuations: number,
  answerSoFar: string,
  canContinue = true,
): StepVerdict {
  if (outcome.toolCalls.length > 0) return { kind: 'ok' }
  if (outcome.finish === 'content_filter')
    return {
      kind: 'fail',
      error: { code: 'content_filter', message: '模型服务商的内容过滤拦下了这次回答', retryable: true },
    }
  if (outcome.finish === 'length') {
    if (canContinue && continuations < MAX_LENGTH_CONTINUATIONS) return { kind: 'continue' }
    return {
      kind: 'fail',
      error: {
        code: 'output_truncated',
        message: `回答超出了模型的输出上限，已自动续写 ${continuations} 次仍未写完`,
        retryable: true,
      },
    }
  }
  if (!outcome.text.trim() && !answerSoFar.trim())
    return { kind: 'fail', error: { code: 'empty_response', message: '模型没有返回任何内容', retryable: true } }
  return { kind: 'ok' }
}

/** Told to the model before a continuation step (prompt-side wording). */
export function continuationFragment(): ContextFragment {
  return createFragment(
    'continuation',
    '<continuation>',
    CONTINUATION_TOKEN_CAP,
    () =>
      '你上一条回复因达到输出长度上限被截断了。请从被截断的地方直接接着写，不要重复已经写过的内容，也不要道歉或解释。',
  )
}
