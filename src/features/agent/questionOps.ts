/**
 * Answering an `ask_user` question: one `question.answer` op on agent:submit (the only path to the kernel). The card
 * leaves when the kernel's question.resolved arrives; a failed submit says so and leaves the card in place to retry.
 */
import type { QuestionAnswer, ThreadId } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { invoke } from '@/platform/hooks'
import { errorMessage } from './agentStoreSupport'

export async function answerQuestion(threadId: ThreadId, questionId: string, answer: QuestionAnswer): Promise<void> {
  try {
    await invoke('agent:submit', { type: 'question.answer', threadId, questionId, answer })
  } catch (e) {
    toast.error(t('agent.question.answerFailed', { error: errorMessage(e) }))
  }
}
