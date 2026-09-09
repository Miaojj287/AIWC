/**
 * One auto-reply record: status glyph · 触发消息 → ↳ 回复 · time + status. Hover reveals 查看原消息 / 撤回
 * (board 152:415 ⑤). Used by the 最近记录 card and the 查看全部 drawer.
 */
import { Ban, Check, CircleAlert, Clock, CornerDownRight, ExternalLink, Undo2 } from 'lucide-react'
import type { AutoReplyRecord, ReplyRecordStatus } from '@aiwc/protocol'
import { Button, ICON_STROKE, cn, type IconComponent } from '@/kit'
import { formatTime } from '@/platform/format'
import { RECORD_STATUS, canRecall, triggerSummary } from '../recordModel'

const STATUS_ICON: Record<ReplyRecordStatus, { icon: IconComponent; className: string }> = {
  sent: { icon: Check, className: 'text-ok' },
  pending: { icon: Clock, className: 'text-warn' },
  failed: { icon: CircleAlert, className: 'text-danger' },
  recalled: { icon: Undo2, className: 'text-fg-3' },
  rejected: { icon: Ban, className: 'text-fg-3' },
}

export interface RecordRowProps {
  record: AutoReplyRecord
  now: number
  onView?: (record: AutoReplyRecord) => void
  onRecall?: (record: AutoReplyRecord) => void
  /** Drawer rows are denser and hide the hover actions. */
  compact?: boolean
}

export function RecordRow({ record, now, onView, onRecall, compact = false }: RecordRowProps) {
  const meta = STATUS_ICON[record.status]
  const status = RECORD_STATUS[record.status]
  const Icon = meta.icon
  const recallable = canRecall(record, now)
  return (
    <div className={cn('group flex items-start gap-2.5 px-4 hover:bg-hover-5', compact ? 'py-2' : 'py-2.5', 'border-b border-line-6 last:border-b-0')} data-status={record.status}>
      <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center', meta.className)}>
        <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body text-fg" title={triggerSummary(record)}>
          {triggerSummary(record)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-fg-3">
          <CornerDownRight size={11} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
          <span className="truncate" title={record.replyText}>
            {record.replyText}
          </span>
        </span>
        {record.error ? <span className="truncate text-micro text-danger">{record.error}</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-latin text-micro text-fg-3">{formatTime(record.at, now)}</span>
        <span className={cn('text-micro', status.tone === 'ok' ? 'text-ok' : status.tone === 'warn' ? 'text-warn' : status.tone === 'danger' ? 'text-danger' : 'text-fg-3')}>{status.label}</span>
      </div>
      {!compact && (onView || (onRecall && recallable)) ? (
        <div className="hidden shrink-0 items-center gap-1 self-center group-hover:flex group-focus-within:flex">
          {onView ? (
            <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => onView(record)}>
              查看原消息
            </Button>
          ) : null}
          {onRecall && recallable ? (
            <Button variant="ghost" size="sm" icon={Undo2} onClick={() => onRecall(record)}>
              撤回
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
