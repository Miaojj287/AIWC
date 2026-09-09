import { describe, expect, it } from 'vitest'
import type { AutoReplyRecord } from '@aiwc/protocol'
import { canRecall, countByStatus, filterRecords, startOfWeek, triggerSummary, upsertRecord } from './recordModel'

const rec = (id: string, at: number, patch: Partial<AutoReplyRecord> = {}): AutoReplyRecord => ({
  id,
  ruleId: 'r1',
  sessionId: 's1',
  triggerMessage: { id: `m-${id}`, text: '报价单能再发一份吗', senderName: '王伟', at },
  replyText: '收到',
  at,
  status: 'sent',
  ...patch,
})

// Wednesday 2026-09-09 10:00 local
const now = new Date(2026, 8, 9, 10, 0).getTime()

describe('recordModel', () => {
  it('allows recall only for sent records inside the window', () => {
    expect(canRecall(rec('a', now, { recallableUntil: now + 1000 }), now)).toBe(true)
    expect(canRecall(rec('a', now, { recallableUntil: now - 1 }), now)).toBe(false)
    expect(canRecall(rec('a', now, { status: 'pending', recallableUntil: now + 1000 }), now)).toBe(false)
    expect(canRecall(rec('a', now), now)).toBe(false)
  })
  it('computes Monday-based weeks and filters by range / status', () => {
    expect(new Date(startOfWeek(now)).getDay()).toBe(1)
    expect(new Date(startOfWeek(new Date(2026, 8, 13, 23).getTime())).getDate()).toBe(7) // Sunday → that week's Monday (7 Sep)
    const list = [rec('today', now - 3600_000), rec('mon', new Date(2026, 8, 7, 9).getTime()), rec('last', new Date(2026, 8, 5, 9).getTime(), { status: 'failed' })]
    expect(filterRecords(list, 'today', now).map((r) => r.id)).toEqual(['today'])
    expect(filterRecords(list, 'week', now).map((r) => r.id)).toEqual(['today', 'mon'])
    expect(filterRecords(list, 'all', now)).toHaveLength(3)
    expect(filterRecords(list, 'all', now, 'failed').map((r) => r.id)).toEqual(['last'])
  })
  it('upserts newest-first with an optional cap', () => {
    const a = rec('a', 1)
    const b = rec('b', 2)
    let list = upsertRecord([a], b)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
    list = upsertRecord(list, { ...a, status: 'recalled' })
    expect(list.find((r) => r.id === 'a')?.status).toBe('recalled')
    expect(upsertRecord(list, rec('c', 3), 2).map((r) => r.id)).toEqual(['c', 'b'])
  })
  it('summarises triggers and counts statuses', () => {
    expect(triggerSummary(rec('a', 1))).toBe('王伟：报价单能再发一份吗')
    expect(triggerSummary(rec('a', 1, { triggerMessage: { id: 'x', text: '', at: 1 } }))).toBe('（非文本消息）')
    expect(countByStatus([rec('a', 1), rec('b', 2, { status: 'pending' })])).toMatchObject({ sent: 1, pending: 1, failed: 0 })
  })
})
