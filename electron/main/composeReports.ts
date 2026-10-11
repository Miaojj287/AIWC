/**
 * Background events the user is told about from the composition root: a toast inside the app and, while the window is
 * in the background, a system notification (composeNotifications.ts). Kept apart so composition.ts stays wiring only.
 */
import type { CloneStatus, ReplyDraft, ToastPayload } from '@aiwc/protocol'
import type { Broadcast } from './contracts'
import type { AttentionNotices } from './composeNotifications'
import { t } from './i18n'
import { localizeText } from './localizePayloads'

export interface ConfirmDraftReportDeps {
  events: { on(listener: (e: { type: string; draftId?: string }) => void): () => void }
  getDraft(draftId: string): ReplyDraft | undefined
  toast(payload: ToastPayload): void
  notices: Pick<AttentionNotices, 'replyDraft'>
}

/**
 * 自动回复 (sendMode 'confirm') parks the reply and tells the user where the button is; the toast is keyed per chat so a
 * newer draft for the same chat replaces it instead of stacking. Retries and drafts that are not waiting are silent.
 */
export function reportConfirmDrafts(deps: ConfirmDraftReportDeps): () => void {
  return deps.events.on((e) => {
    if (e.type !== 'autoreply.queued' || !e.draftId) return
    const draft = deps.getDraft(e.draftId)
    if (
      !draft ||
      draft.state !== 'pending' ||
      draft.mode !== 'confirm' ||
      !draft.ruleId ||
      draft.triggerMessageId.startsWith('retry_')
    )
      return
    const name = draft.source.displayName ?? draft.source.chatId
    deps.toast({
      id: `autoreply.confirm.${draft.source.chatId}`,
      kind: 'info',
      text: t('main.autoReply.draftReady', { name }),
      action: {
        label: t('main.autoReply.goConfirm'),
        command: 'tab.openAutoReply',
        payload: { sessionId: draft.source.chatId, title: name },
      },
    })
    deps.notices.replyDraft({ sessionId: draft.source.chatId, name: draft.source.displayName })
  })
}

/** Clone progress → the renderer (only real changes), plus a toast when a clone is ready or failed. */
export function createCloneStatusReporter(deps: { broadcast: Broadcast; toast(payload: ToastPayload): void }) {
  const last = new Map<string, string>()
  return (e: { contactId: string; status: CloneStatus }): void => {
    const key = JSON.stringify(e.status)
    if (last.get(e.contactId) === key) return
    last.set(e.contactId, key)
    deps.broadcast('clone:status', e)
    if (e.status.state === 'ready')
      deps.toast({
        kind: 'success',
        text: t('main.clone.done'),
        action: { label: t('main.clone.view'), command: 'tab.openClone' },
      })
    if (e.status.state === 'failed')
      deps.toast({ kind: 'error', text: t('main.clone.failed', { error: localizeText(e.status.error) }), sticky: true })
  }
}
