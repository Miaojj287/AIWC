/**
 * The conversation's single polite live region, visually hidden. It speaks two one-off sentences: an approval is
 * waiting (the card no longer pulls focus out of the composer, so this is how a screen reader learns of it) and
 * the turn ended. Streamed text, the elapsed counter and tool rows stay silent; an error card is an alert of its own.
 * Mount it with `key={threadId}` so switching threads starts from silence.
 */
import { useState } from 'react'
import { useT } from '@/i18n'
import { ABORT_TEXT } from './messages/Notices'
import type { ApprovalRequest, ThreadItem } from './model'
import { toolCallLabel } from './toolSummaries'

export interface TurnAnnouncerProps {
  streaming: boolean
  items: readonly ThreadItem[]
  pendingApprovals: readonly ApprovalRequest[]
}

export function TurnAnnouncer({ streaming, items, pendingApprovals }: TurnAnnouncerProps) {
  const t = useT()
  // "The turn just ended" is a transition, so the previous flag is kept in state and compared during render.
  const [wasStreaming, setWasStreaming] = useState(streaming)
  const [ended, setEnded] = useState(false)
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming)
    // A new turn clears the sentence, so the next ending changes the text again and is announced again.
    setEnded(!streaming)
  }

  const pending = pendingApprovals[0]
  const last = items[items.length - 1]
  let text = ''
  if (pending) text = t('agent.live.approvalRequested', { summary: toolCallLabel(pending, t) })
  else if (ended && last?.kind === 'aborted') text = t(ABORT_TEXT[last.reason])
  else if (ended && last?.kind !== 'error') text = t('agent.live.turnFinished')

  return (
    <div role="status" className="sr-only" data-testid="agent-live-status">
      {text}
    </div>
  )
}
