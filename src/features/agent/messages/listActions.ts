/**
 * MessageList's default handling of error-card actions and of 重新生成 when the host only gave `onResend`, kept apart
 * so the list stays under the file ceiling (AGENTS.md §2.3).
 */
import type { ContentPart, DraftAttachment, ErrorAction, Mention } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { draftAttachmentsOf } from '../composer/attachments'
import type { ThreadItem } from '../model'
import type { AssistantItem } from './AssistantMessage'
import type { ErrorItem } from './ErrorCard'

export interface ErrorActionDeps {
  items: readonly ThreadItem[]
  onCompact?: () => void
  onRetry?: (item: ErrorItem) => void
  onResend?: (text: string, mentions: Mention[], attachments?: DraftAttachment[]) => void
  onDismiss: (item: ErrorItem) => void
}

/** A prompt's typed text (attachments travel separately, as parts). */
const typedText = (content: ContentPart[]) => content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')

/** Send a prompt again: its text, chips and — when it had any — its attachments. */
function resend(
  onResend: ((text: string, mentions: Mention[], attachments?: DraftAttachment[]) => void) | undefined,
  user: { content: ContentPart[]; mentions: Mention[] },
): void {
  const attachments = draftAttachmentsOf(user.content)
  if (attachments.length) onResend?.(typedText(user.content), user.mentions, attachments)
  else onResend?.(typedText(user.content), user.mentions)
}

/** The newest prompt of `turnId` (or the newest prompt at all). */
function promptOf(items: readonly ThreadItem[], turnId: string | undefined) {
  const user = [...items].reverse().find((it) => it.kind === 'user' && (turnId === undefined || it.turnId === turnId))
  return user?.kind === 'user' ? user : undefined
}

export function handleErrorAction(action: ErrorAction, item: ErrorItem, deps: ErrorActionDeps): void {
  switch (action.action) {
    case 'open_settings_ai':
      runCommand('tab.openSettings', { page: 'ai' })
      return
    case 'open_settings_account':
      runCommand('tab.openSettings', { page: 'account' })
      return
    case 'compact':
      deps.onCompact?.()
      return
    case 'retry': {
      if (deps.onRetry) {
        deps.onRetry(item)
        return
      }
      const user = promptOf(deps.items, item.turnId)
      if (user) resend(deps.onResend, user)
      return
    }
    case 'dismiss':
      deps.onDismiss(item)
      return
  }
}

/** 重新生成 as "send the turn's prompt again", for hosts without a rewind (the clone page). */
export function regenerateByResend(
  items: readonly ThreadItem[],
  onResend: ((text: string, mentions: Mention[], attachments?: DraftAttachment[]) => void) | undefined,
): ((item: AssistantItem) => void) | undefined {
  if (!onResend) return undefined
  return (item) => {
    const user = [...items].reverse().find((it) => it.kind === 'user' && it.turnId === item.turnId)
    if (user?.kind === 'user') resend(onResend, user)
  }
}
