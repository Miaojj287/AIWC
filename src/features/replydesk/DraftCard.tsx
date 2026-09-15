/**
 * One reply draft awaiting a decision: source, trigger text, editable draft, auto-send countdown and
 * 拒绝 / 修改后发送 / 发送 → autoreply:resolveDraft. Failed drafts show the error with 重试 / 关闭.
 */
import { Check, Pencil, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import type { ReplyDraft } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Avatar, Badge, Button, Card, InlineHint, ProgressBar, Textarea, toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { formatTime } from '@/platform/format'
import { invoke } from '@/platform/hooks'
import { MODE_LABEL_KEY } from './reducer'

export interface DraftCardProps {
  draft: ReplyDraft
  /** Remaining ms for auto drafts (undefined otherwise). */
  remainingMs: number | undefined
  countdownTotalMs: number
  onDismiss: (draftId: string) => void
  /** Only one primary button per view (CLAUDE.md §3): the desk passes true for the first pending draft. */
  primary?: boolean
}

type Decision = 'approve' | 'reject' | 'edit'

const MODE_TONE = { suggest: 'info', confirm: 'warn', auto: 'accent' } as const

export function DraftCard({ draft, remainingMs, countdownTotalMs, onDismiss, primary = false }: DraftCardProps) {
  const t = useT()
  const [text, setText] = useState(draft.draft)
  const [busy, setBusy] = useState<Decision | null>(null)
  const edited = text.trim() !== draft.draft.trim()
  const name = draft.source.displayName ?? draft.source.chatId
  const failed = draft.state === 'failed'

  const resolve = async (decision: Decision) => {
    setBusy(decision)
    try {
      if (failed) await invoke('autoreply:retryDraft', { draftId: draft.id })
      else
        await invoke('autoreply:resolveDraft', {
          draftId: draft.id,
          decision,
          text: decision === 'edit' ? text.trim() : undefined,
        })
      if (decision === 'reject') toast.info(t('replydesk.draft.ignored', { name }))
      else if (failed && !draft.draft) toast.info(t('replydesk.draft.regenerated'))
      else toast.success(t('replydesk.draft.sentTo', { name }))
    } catch (e) {
      toast.error(t('common.operationFailed'), { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const seconds = remainingMs !== undefined ? Math.ceil(remainingMs / 1000) : undefined
  const sendVariant = primary ? 'primary' : 'outline'

  return (
    <Card className="flex flex-col gap-3" data-draft-state={draft.state} data-draft-mode={draft.mode}>
      <div className="flex items-center gap-2.5">
        <Avatar id={draft.source.chatId} name={name} size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Button
              variant="link"
              size="sm"
              className="-ml-2.5 min-w-0 shrink text-body"
              onClick={() =>
                runCommand('tab.openChat', {
                  sessionId: draft.source.chatId,
                  title: name,
                  focusMessageId: draft.triggerLocalId ?? draft.triggerMessageId,
                })
              }
            >
              <span className="truncate">{name}</span>
            </Button>
            <Badge tone={failed ? 'danger' : MODE_TONE[draft.mode]}>
              {failed
                ? draft.draft
                  ? t('replydesk.draft.sendFailed')
                  : t('replydesk.draft.generateFailed')
                : t(MODE_LABEL_KEY[draft.mode])}
            </Badge>
            {draft.source.chatType === 'group' ? (
              <span className="text-micro text-fg-3">{t('replydesk.draft.group')}</span>
            ) : null}
          </span>
          <span className="font-latin text-micro text-fg-3">{formatTime(draft.createdAt)}</span>
        </div>
      </div>
      <div className="rounded-item border border-line-6 bg-content px-3 py-2 text-caption leading-[18px] text-fg-2">
        <span className="text-fg-3">{t('replydesk.draft.originalLabel')}</span>
        {draft.triggerText}
      </div>
      {draft.suggestions && draft.suggestions.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {draft.suggestions.map((suggestion, index) => (
            <Button
              key={index}
              size="sm"
              variant={text === suggestion ? 'outline' : 'ghost'}
              disabled={draft.mode === 'auto' || busy !== null}
              onClick={() => setText(suggestion)}
            >
              {t('replydesk.draft.candidate', { n: index + 1 })}
            </Button>
          ))}
        </div>
      ) : null}
      {draft.mode === 'auto' && !failed ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void invoke('autoreply:holdDraft', { draftId: draft.id }).catch((e) => toast.error(String(e)))
          }}
        >
          {t('replydesk.draft.holdAndEdit')}
        </Button>
      ) : null}
      <Textarea
        readOnly={draft.mode === 'auto'}
        autosize
        minRows={2}
        maxRows={8}
        aria-label={t('replydesk.draft.draftLabel')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy !== null || failed}
      />
      {draft.mode === 'auto' && !failed && seconds !== undefined ? (
        <div className="flex items-center gap-2">
          <ProgressBar
            value={
              countdownTotalMs > 0
                ? Math.max(0, Math.min(100, ((remainingMs ?? 0) / countdownTotalMs) * 100))
                : undefined
            }
            label={t('replydesk.draft.countdownLabel')}
            className="flex-1"
          />
          <span className="shrink-0 font-latin text-micro tabular-nums text-fg-3">
            {seconds > 0 ? t('replydesk.draft.sendingIn', { n: seconds }) : t('replydesk.draft.sending')}
          </span>
        </div>
      ) : null}
      {failed ? <InlineHint kind="error">{draft.error ?? t('replydesk.draft.sendFailed')}</InlineHint> : null}
      <div className="flex items-center justify-end gap-2">
        {failed ? (
          <>
            <Button variant="ghost" onClick={() => onDismiss(draft.id)}>
              {t('common.close')}
            </Button>
            <Button
              variant={sendVariant}
              icon={Check}
              loading={busy === 'approve'}
              onClick={() => void resolve('approve')}
            >
              {draft.draft ? t('replydesk.draft.retrySend') : t('replydesk.draft.regenerate')}
            </Button>
          </>
        ) : (
          <>
            {draft.suggestions?.length ? (
              <Button
                variant="ghost"
                icon={RefreshCw}
                disabled={busy !== null}
                onClick={() => {
                  setBusy('edit')
                  void invoke('autoreply:retryDraft', { draftId: draft.id })
                    .catch((e) => toast.error(t('replydesk.draft.regenerateFailed'), { detail: String(e) }))
                    .finally(() => setBusy(null))
                }}
              >
                {t('replydesk.draft.regenerate')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              icon={X}
              loading={busy === 'reject'}
              disabled={busy !== null && busy !== 'reject'}
              onClick={() => void resolve('reject')}
            >
              {t('replydesk.draft.reject')}
            </Button>
            <Button
              variant="outline"
              icon={Pencil}
              loading={busy === 'edit'}
              disabled={!edited || !text.trim() || (busy !== null && busy !== 'edit')}
              title={!edited ? t('replydesk.draft.editToEnable') : undefined}
              onClick={() => void resolve('edit')}
            >
              {t('replydesk.draft.sendEdited')}
            </Button>
            <Button
              variant={sendVariant}
              icon={Check}
              loading={busy === 'approve'}
              disabled={edited || (busy !== null && busy !== 'approve')}
              title={edited ? t('replydesk.draft.useSendEdited') : undefined}
              onClick={() => void resolve('approve')}
            >
              {t('common.send')}
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}
