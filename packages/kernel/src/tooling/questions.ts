/**
 * `ask_user`: the agent asks the user a multiple-choice question when a request is ambiguous and waits for the
 * answer. The question takes the composer's place in the UI like an approval (numbered options, 其他 for free text,
 * Esc = no answer); the turn's time budget pauses while it waits. Only a desktop thread at depth 0 has someone to
 * ask: in a scheduled run, a WeChat bot thread or a sub-agent the call fails at once with a message telling the
 * model to proceed on its own judgement.
 *
 * The pending-question registry mirrors the approval gate: the router binds `ToolContext.askUser` to it, and the
 * Thread resolves it from the `question.answer` op.
 */
import { z } from 'zod'
import {
  defineTool,
  newQuestionId,
  questionAnswerText,
  QUESTION_MAX_OPTIONS,
  QUESTION_MIN_OPTIONS,
  type AnyToolDefinition,
  type CallId,
  type JsonValue,
  type QuestionAnswer,
  type ThreadId,
  type UserQuestionRequest,
} from '@aiwc/protocol'
import type { QuestionGate, ToolDispatchContext } from '../ports'

export function createQuestionGate(): QuestionGate {
  const pending = new Map<string, { threadId: ThreadId; settle: (answer: QuestionAnswer) => void }>()
  return {
    ask(req, signal) {
      if (signal.aborted) return Promise.resolve({ kind: 'dismissed' })
      return new Promise<QuestionAnswer>((resolve) => {
        const onAbort = (): void => settle({ kind: 'dismissed' })
        const settle = (answer: QuestionAnswer): void => {
          if (!pending.has(req.questionId)) return
          pending.delete(req.questionId)
          signal.removeEventListener('abort', onAbort)
          resolve(answer)
        }
        pending.set(req.questionId, { threadId: req.threadId, settle })
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },
    resolve(questionId, answer, threadId) {
      const entry = pending.get(questionId)
      if (!entry || (threadId !== undefined && entry.threadId !== threadId)) return false
      entry.settle(answer)
      return true
    },
    cancelAll(threadId) {
      for (const [, entry] of [...pending]) if (entry.threadId === threadId) entry.settle({ kind: 'dismissed' })
    },
  }
}

/**
 * The router's `ToolContext.askUser` for one call: emits question.requested, pauses the turn budget, waits for the
 * gate, emits question.resolved. Undefined where nobody can answer.
 */
export function bindAskUser(
  gate: QuestionGate | undefined,
  ctx: ToolDispatchContext,
  callId: CallId,
  signal: AbortSignal,
): ((q: UserQuestionRequest) => Promise<QuestionAnswer>) | undefined {
  if (!gate || ctx.channel !== 'desktop' || ctx.depth > 0) return undefined
  return async (q) => {
    const questionId = newQuestionId()
    ctx.emit({
      type: 'question.requested',
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      questionId,
      callId,
      question: q.question,
      options: q.options,
      allowOther: q.allowOther,
    })
    const endWait = ctx.onApprovalWait?.()
    let answer: QuestionAnswer
    try {
      answer = await gate.ask({ questionId, threadId: ctx.threadId }, signal)
    } finally {
      endWait?.()
    }
    ctx.emit({ type: 'question.resolved', threadId: ctx.threadId, questionId, answer })
    return answer
  }
}

/** Long enough for a user who stepped away; the turn budget is paused meanwhile anyway. */
const ASK_USER_TIMEOUT_MS = 24 * 60 * 60_000

const AskUserInput = z.object({
  question: z.string().trim().min(1).max(300).describe('要问用户的问题，一句话'),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60).describe('选项文字，简短'),
        description: z.string().trim().max(120).optional().describe('可选：一句补充说明'),
      }),
    )
    .min(QUESTION_MIN_OPTIONS)
    .max(QUESTION_MAX_OPTIONS)
    .describe(`${QUESTION_MIN_OPTIONS}–${QUESTION_MAX_OPTIONS} 个互斥的选项`),
  allow_other: z.boolean().default(true).describe('是否允许用户不选选项、自己输入回答（默认允许）'),
})
type AskUserInputT = z.infer<typeof AskUserInput>

export const NO_USER_TO_ASK_MESSAGE =
  '当前没有用户可以回答问题（例如定时任务或微信机器人会话）。不要再提问，按最合理的理解继续完成任务，并在结果里写明你做的假设。'

export function askUserTool(): AnyToolDefinition {
  return defineTool<AskUserInputT>({
    name: 'ask_user',
    description:
      '当用户的要求有歧义、缺少关键信息、并且猜错代价较高时，用选项卡片向用户提问并等待回答。给出 2–5 个互斥的具体选项；不要用它确认显而易见的事，也不要连续追问。用户可能选择一个选项、自己输入，或不回答。',
    inputSchema: AskUserInput,
    profiles: ['desktop-chat', 'cron'],
    risk: 'read',
    parallelSafe: false,
    timeoutMs: ASK_USER_TIMEOUT_MS,
    summarize: (i) => `向你提问：${i.question}`,
    async execute(input, ctx) {
      if (!ctx.askUser) return { content: NO_USER_TO_ASK_MESSAGE, isError: true }
      const answer = await ctx.askUser({
        question: input.question,
        options: input.options.map((o) =>
          o.description ? { label: o.label, description: o.description } : { label: o.label },
        ),
        allowOther: input.allow_other,
      })
      return { content: questionAnswerText(answer), meta: { answer: answer as unknown as JsonValue } }
    },
  })
}
