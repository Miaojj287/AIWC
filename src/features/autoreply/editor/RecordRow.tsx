/**
 * One auto-reply record: status glyph · 触发消息 → ↳ 回复 · time + status. Hover reveals 查看原消息 / 撤回
 * (board 152:415 ⑤). Used by the 最近记录 card and the 查看全部 drawer.
 *
 * A record whose reply is parked (rule sendMode 'confirm') is the one place the reply gets sent from:
 * the row grows into an editable draft with 忽略 / 修改后发送 / 确认发送. A record still counting down
 * (sendMode 'auto') offers 取消发送 instead. Rows with such inline buttons show 查看原消息 inline too and
 * never grow the hover column: that column appearing on hover pushed 确认发送 out from under the cursor.
 */
import { Ban, Check, CircleAlert, Clock, CornerDownRight, ExternalLink, Pencil, Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AutoReplyRecord, ReplyRecordStatus } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, ICON_STROKE, Textarea, cn, type IconComponent } from '@/kit'
import { formatTime } from '@/platform/format'
import { RECORD_STATUS, canRecall, isAwaitingConfirm, recordStatusLabel, triggerSummary } from '../recordModel'

const STATUS_ICON: Record<ReplyRecordStatus, { icon: IconComponent; className: string }> = {
  sent: { icon: Check, className: 'text-ok' },
  pending: { icon: Clock, className: 'text-warn' },
  failed: { icon: CircleAlert, className: 'text-danger' },
  recalled: { icon: Undo2, className: 'text-fg-3' },
  rejected: { icon: Ban, className: 'text-fg-3' },
}

export type RecordDecision = 'approve' | 'edit' | 'reject'

export interface RecordRowProps {
  record: AutoReplyRecord
  now: number
  onView?: (record: AutoReplyRecord) => void
  onRecall?: (record: AutoReplyRecord) => void
  /** Send (approve / edit) or drop (reject) the pending draft behind this record. */
  onDecide?: (record: AutoReplyRecord, decision: RecordDecision, text?: string) => Promise<void>
  /** Only one primary button per card (CLAUDE.md §3): the card passes true for the oldest parked reply. */
  primary?: boolean
  /** Drawer rows are denser and hide the hover actions (the parked-reply buttons stay). */
  compact?: boolean
}

export function RecordRow({
  record,
  now,
  onView,
  onRecall,
  onDecide,
  primary = false,
  compact = false,
}: RecordRowProps) {
  const t = useT()
  const meta = STATUS_ICON[record.status]
  const status = RECORD_STATUS[record.status]
  const Icon = meta.icon
  const recallable = canRecall(record, now)
  const parked = isAwaitingConfirm(record) && Boolean(onDecide)
  const countingDown =
    record.status === 'pending' && record.sendMode === 'auto' && Boolean(record.draftId) && Boolean(onDecide)
  const inlineActions = parked || countingDown
  const viewInline =
    inlineActions && onView ? (
      <Button variant="link" size="sm" icon={ExternalLink} className="mr-auto" onClick={() => onView(record)}>
        {t('autoreply.records.viewOriginal')}
      </Button>
    ) : null
  const [text, setText] = useState(record.replyText)
  const [busy, setBusy] = useState<RecordDecision | null>(null)
  useEffect(() => setText(record.replyText), [record.replyText])
  const edited = text.trim() !== record.replyText.trim()

  const decide = async (decision: RecordDecision) => {
    if (!onDecide) return
    setBusy(decision)
    try {
      await onDecide(record, decision, decision === 'edit' ? text.trim() : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 px-4 hover:bg-hover-5',
        compact ? 'py-2' : 'py-2.5',
        'border-b border-line-6 last:border-b-0',
        parked && 'bg-warn/5',
      )}
      data-status={record.status}
      data-parked={parked || undefined}
    >
      <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center', meta.className)}>
        <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body text-fg" title={triggerSummary(record)}>
          {triggerSummary(record)}
        </span>
        {parked && !compact ? (
          <div className="mt-1 flex flex-col gap-2">
            <Textarea
              autosize
              minRows={2}
              maxRows={6}
              aria-label={t('autoreply.records.pendingReplyLabel')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy !== null}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {viewInline}
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                loading={busy === 'reject'}
                disabled={busy !== null && busy !== 'reject'}
                onClick={() => void decide('reject')}
              >
                {t('autoreply.records.ignore')}
              </Button>
              {edited ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={Pencil}
                  loading={busy === 'edit'}
                  disabled={!text.trim() || (busy !== null && busy !== 'edit')}
                  onClick={() => void decide('edit')}
                >
                  {t('autoreply.records.sendEdited')}
                </Button>
              ) : (
                <Button
                  variant={primary ? 'primary' : 'outline'}
                  size="sm"
                  icon={Check}
                  loading={busy === 'approve'}
                  disabled={busy !== null && busy !== 'approve'}
                  onClick={() => void decide('approve')}
                >
                  {t('autoreply.records.confirmSend')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <span className="flex min-w-0 items-center gap-1 text-caption text-fg-3">
            <CornerDownRight size={11} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate" title={record.replyText}>
              {record.replyText}
            </span>
          </span>
        )}
        {parked && compact ? (
          <div className="mt-1 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              loading={busy === 'reject'}
              disabled={busy !== null && busy !== 'reject'}
              onClick={() => void decide('reject')}
            >
              {t('autoreply.records.ignore')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={Check}
              loading={busy === 'approve'}
              disabled={busy !== null && busy !== 'approve'}
              onClick={() => void decide('approve')}
            >
              {t('autoreply.records.confirmSend')}
            </Button>
          </div>
        ) : null}
        {countingDown ? (
          <div className="mt-1 flex items-center gap-2">
            {compact ? null : viewInline}
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              loading={busy === 'reject'}
              disabled={busy !== null}
              onClick={() => void decide('reject')}
            >
              {t('autoreply.records.cancelSend')}
            </Button>
          </div>
        ) : null}
        {record.error ? <span className="truncate text-micro text-danger">{record.error}</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-latin text-micro text-fg-3">{formatTime(record.at, now)}</span>
        <span
          className={cn(
            'text-micro',
            status.tone === 'ok'
              ? 'text-ok'
              : status.tone === 'warn'
                ? 'text-warn'
                : status.tone === 'danger'
                  ? 'text-danger'
                  : 'text-fg-3',
          )}
        >
          {recordStatusLabel(record)}
        </span>
      </div>
      {!compact && !inlineActions && (onView || (onRecall && recallable)) ? (
        <div className="hidden shrink-0 items-center gap-1 self-center group-hover:flex group-focus-within:flex">
          {onView ? (
            <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => onView(record)}>
              {t('autoreply.records.viewOriginal')}
            </Button>
          ) : null}
          {onRecall && recallable ? (
            <Button variant="ghost" size="sm" icon={Undo2} onClick={() => onRecall(record)}>
              {t('autoreply.records.recall')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
