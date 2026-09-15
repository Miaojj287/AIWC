/**
 * Auto-reply record helpers (DESIGN-SPEC §3 记录): status copy, recall window, range filters for the
 * drawer and the live upsert used by the 'autoreply:record' push. Pure — tested in recordModel.test.ts.
 */
import type { AutoReplyRecord, ReplyRecordStatus } from '@aiwc/protocol'
import { t, type MessageKey } from '@/i18n'

export type RecordTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'

export const RECORD_STATUS: Record<ReplyRecordStatus, { labelKey: MessageKey; tone: RecordTone }> = {
  sent: { labelKey: 'autoreply.records.status.sent', tone: 'ok' },
  pending: { labelKey: 'autoreply.records.status.pending', tone: 'warn' },
  failed: { labelKey: 'autoreply.records.status.failed', tone: 'danger' },
  recalled: { labelKey: 'autoreply.records.status.recalled', tone: 'neutral' },
  rejected: { labelKey: 'autoreply.records.status.rejected', tone: 'neutral' },
}

/** WeChat allows recalling within 2 minutes; the backend stamps `recallableUntil` when the channel supports it. */
export function canRecall(record: AutoReplyRecord, now: number): boolean {
  return record.status === 'sent' && record.recallableUntil !== undefined && record.recallableUntil > now
}

export type RecordRange = 'today' | 'week' | 'all'

export const RECORD_RANGES: ReadonlyArray<{ value: RecordRange; labelKey: MessageKey }> = [
  { value: 'today', labelKey: 'autoreply.records.range.today' },
  { value: 'week', labelKey: 'autoreply.records.range.week' },
  { value: 'all', labelKey: 'common.all' },
]

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Monday 00:00 of the week containing `ms` (local time). */
export function startOfWeek(ms: number): number {
  const day0 = startOfDay(ms)
  const dow = new Date(day0).getDay() // 0 = Sunday
  const offset = (dow + 6) % 7
  return day0 - offset * 86_400_000
}

export function filterRecords(
  records: readonly AutoReplyRecord[],
  range: RecordRange,
  now: number,
  status: ReplyRecordStatus | 'all' = 'all',
): AutoReplyRecord[] {
  const from = range === 'today' ? startOfDay(now) : range === 'week' ? startOfWeek(now) : -Infinity
  return records.filter((r) => r.at >= from && (status === 'all' || r.status === status))
}

/** Insert or replace by id, newest first, optionally capped. */
export function upsertRecord(
  records: readonly AutoReplyRecord[],
  record: AutoReplyRecord,
  limit?: number,
): AutoReplyRecord[] {
  const rest = records.filter((r) => r.id !== record.id)
  const next = [record, ...rest].sort((a, b) => b.at - a.at)
  return limit !== undefined ? next.slice(0, limit) : next
}

/** `王伟：报价单能再发一份吗` — sender prefix only when known. */
export function triggerSummary(record: AutoReplyRecord): string {
  const text = record.triggerMessage.text || t('autoreply.records.nonText')
  return record.triggerMessage.senderName
    ? t('autoreply.records.triggerSummary', { sender: record.triggerMessage.senderName, text })
    : text
}

/** A record whose reply is parked behind the 确认发送 button (sendMode 'confirm', draft still pending). */
export function isAwaitingConfirm(record: AutoReplyRecord): boolean {
  return record.status === 'pending' && record.sendMode === 'confirm' && Boolean(record.draftId)
}

/** Status copy that tells the two pending cases apart: parked (needs a click) vs counting down. */
export function recordStatusLabel(record: AutoReplyRecord): string {
  if (record.status === 'pending')
    return record.sendMode === 'auto'
      ? t('autoreply.records.status.sendingSoon')
      : t('autoreply.records.status.pending')
  return t(RECORD_STATUS[record.status].labelKey)
}

export function countByStatus(records: readonly AutoReplyRecord[]): Record<ReplyRecordStatus, number> {
  const out: Record<ReplyRecordStatus, number> = { sent: 0, pending: 0, failed: 0, recalled: 0, rejected: 0 }
  for (const r of records) out[r.status]++
  return out
}
