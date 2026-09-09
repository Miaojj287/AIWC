/**
 * Auto-reply record helpers (DESIGN-SPEC §3 记录): status copy, recall window, range filters for the
 * drawer and the live upsert used by the 'autoreply:record' push. Pure — tested in recordModel.test.ts.
 */
import type { AutoReplyRecord, ReplyRecordStatus } from '@aiwc/protocol'

export type RecordTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'

export const RECORD_STATUS: Record<ReplyRecordStatus, { label: string; tone: RecordTone }> = {
  sent: { label: '已发送', tone: 'ok' },
  pending: { label: '待确认', tone: 'warn' },
  failed: { label: '失败', tone: 'danger' },
  recalled: { label: '已撤回', tone: 'neutral' },
  rejected: { label: '已忽略', tone: 'neutral' },
}

/** WeChat allows recalling within 2 minutes; the backend stamps `recallableUntil` when the channel supports it. */
export function canRecall(record: AutoReplyRecord, now: number): boolean {
  return record.status === 'sent' && record.recallableUntil !== undefined && record.recallableUntil > now
}

export type RecordRange = 'today' | 'week' | 'all'

export const RECORD_RANGES: ReadonlyArray<{ value: RecordRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'all', label: '全部' },
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

export function filterRecords(records: readonly AutoReplyRecord[], range: RecordRange, now: number, status: ReplyRecordStatus | 'all' = 'all'): AutoReplyRecord[] {
  const from = range === 'today' ? startOfDay(now) : range === 'week' ? startOfWeek(now) : -Infinity
  return records.filter((r) => r.at >= from && (status === 'all' || r.status === status))
}

/** Insert or replace by id, newest first, optionally capped. */
export function upsertRecord(records: readonly AutoReplyRecord[], record: AutoReplyRecord, limit?: number): AutoReplyRecord[] {
  const rest = records.filter((r) => r.id !== record.id)
  const next = [record, ...rest].sort((a, b) => b.at - a.at)
  return limit !== undefined ? next.slice(0, limit) : next
}

/** `王伟：报价单能再发一份吗` — sender prefix only when known. */
export function triggerSummary(record: AutoReplyRecord): string {
  const text = record.triggerMessage.text || '（非文本消息）'
  return record.triggerMessage.senderName ? `${record.triggerMessage.senderName}：${text}` : text
}

export function countByStatus(records: readonly AutoReplyRecord[]): Record<ReplyRecordStatus, number> {
  const out: Record<ReplyRecordStatus, number> = { sent: 0, pending: 0, failed: 0, recalled: 0, rejected: 0 }
  for (const r of records) out[r.status]++
  return out
}
