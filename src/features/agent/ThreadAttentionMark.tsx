/**
 * The trailing status of a thread row (Agent window sidebar, history list) once nothing is running: a dot for a
 * reply that finished unseen, a red mark for a turn that failed (threadAttention.ts). Waiting states (generating,
 * awaiting approval, a question) are shown by the row itself and take precedence.
 */
import { CircleHelp, CircleX } from 'lucide-react'
import type { ThreadId } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { ICON_STROKE, Tooltip } from '@/kit'
import { useThreadAttention, type AttentionMark } from './threadAttention'

export function useAttentionMark(threadId: ThreadId): AttentionMark | undefined {
  return useThreadAttention((s) => s.marks[threadId])
}

export function ThreadAttentionMark({ threadId }: { threadId: ThreadId }) {
  const t = useT()
  const mark = useAttentionMark(threadId)
  if (mark === 'failed')
    return (
      <Tooltip content={t('agent.attention.failed')}>
        <CircleX size={14} strokeWidth={ICON_STROKE} aria-label={t('agent.attention.failed')} className="text-danger" />
      </Tooltip>
    )
  if (mark === 'unread')
    return (
      <Tooltip content={t('agent.attention.unread')}>
        <span role="img" aria-label={t('agent.attention.unread')} className="mx-1 size-2 rounded-chip bg-accent" />
      </Tooltip>
    )
  return null
}

/** A question from the agent is waiting in this thread. */
export function ThreadQuestionMark() {
  const t = useT()
  return (
    <Tooltip content={t('agent.attention.question')}>
      <CircleHelp
        size={14}
        strokeWidth={ICON_STROKE}
        aria-label={t('agent.attention.question')}
        className="text-warn"
      />
    </Tooltip>
  )
}
