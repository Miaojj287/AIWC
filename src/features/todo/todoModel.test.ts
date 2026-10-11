import { afterEach, describe, expect, it } from 'vitest'
import type { TodoConfig, TodoItem, TodoScanResult, TodoStatus } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage, t } from '@/i18n'
import {
  adjacentDays,
  dayLabel,
  describeTodoSchedule,
  openCountBySource,
  scanOutcome,
  scanTime,
  statusLine,
  summaryWindow,
  visibleItems,
} from './todoModel'

const NOW = new Date('2026-09-27T15:30:00').getTime()
const HOUR = 3_600_000
const clock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const item = (id: string, over: Partial<TodoItem> = {}): TodoItem => ({
  id,
  text: id,
  origin: 'scan',
  createdAt: NOW,
  done: false,
  ...over,
})

const result = (over: Partial<TodoScanResult> = {}): TodoScanResult => ({
  ok: true,
  trigger: 'manual',
  startedAt: NOW,
  finishedAt: NOW,
  scanned: 2,
  failed: 0,
  messages: 10,
  added: 3,
  ...over,
})

afterEach(() => __resetLanguageForTests())

describe('todo model', () => {
  it('splits open (newest first) from checked (latest checked first), optionally for one chat', () => {
    const items = [
      item('old', { createdAt: NOW - 2 * HOUR, sourceId: 'g1' }),
      item('new', { createdAt: NOW, sourceId: 'g2' }),
      item('done1', { done: true, doneAt: NOW - HOUR, sourceId: 'g1' }),
      item('done2', { done: true, doneAt: NOW, sourceId: 'g1' }),
    ]
    const all = visibleItems(items)
    expect(all.open.map((i) => i.id)).toEqual(['new', 'old'])
    expect(all.done.map((i) => i.id)).toEqual(['done2', 'done1'])
    expect(visibleItems(items, 'g1').open.map((i) => i.id)).toEqual(['old'])
    expect(openCountBySource(items)).toEqual(
      new Map([
        ['g1', 1],
        ['g2', 1],
      ]),
    )
  })

  it('describes schedules and status in both languages', () => {
    expect(describeTodoSchedule({ kind: 'hourly', everyHours: 2 }, t)).toBe('每 2 小时')
    expect(describeTodoSchedule({ kind: 'daily', time: '09:00' }, t)).toBe('每天 09:00')
    const status: TodoStatus = { enabled: true, sources: 2, running: false, nextRunAt: NOW + HOUR }
    const config: Pick<TodoConfig, 'enabled' | 'schedule'> = {
      enabled: true,
      schedule: { kind: 'hourly', everyHours: 2 },
    }
    const line = (s: TodoStatus, c = config) => statusLine(c, s, t, (ms) => scanTime(ms, t, clock, NOW))
    expect(line(status)).toBe('每 2 小时 · 尚未扫描 · 下次 16:30')
    expect(line({ ...status, last: result({ startedAt: NOW - 20 * HOUR }) })).toBe(
      '每 2 小时 · 上次 昨天 19:30 · 下次 16:30',
    )
    // The live config wins over a status fetched before the switch was flipped.
    expect(line(status, { ...config, enabled: false })).toBe('已关闭，不会扫描')
    setLanguage('en-US')
    expect(describeTodoSchedule({ kind: 'hourly', everyHours: 1 }, t)).toBe('Every hour')
    expect(describeTodoSchedule({ kind: 'hourly', everyHours: 6 }, t)).toBe('Every 6 hours')
    expect(scanTime(NOW + 20 * HOUR, t, clock, NOW)).toBe('tomorrow 11:30')
  })

  it('turns a scan result into one message', () => {
    expect(scanOutcome(result(), t)).toEqual({ kind: 'success', text: '新增 3 条待办' })
    expect(scanOutcome(result({ added: 0 }), t).text).toBe('已扫描 2 个群聊，没有新待办')
    expect(scanOutcome(result({ messages: 0, added: 0 }), t)).toEqual({ kind: 'info', text: '没有新消息' })
    expect(scanOutcome(result({ failed: 1, added: 1, detail: '429' }), t)).toMatchObject({
      kind: 'warning',
      detail: '429',
    })
    expect(scanOutcome(result({ ok: false, failure: 'model_unavailable' }), t)).toEqual({
      kind: 'error',
      text: '没有可用的模型',
    })
    expect(scanOutcome(result({ ok: false, failure: 'cancelled' }), t).kind).toBe('info')
  })

  it('labels days and steps through them', () => {
    expect(dayLabel('2026-09-27', t, NOW)).toBe('今天')
    expect(dayLabel('2026-09-26', t, NOW)).toBe('昨天')
    expect(dayLabel('2026-09-20', t, NOW)).toBe('9月20日')
    const days = ['2026-09-27', '2026-09-26', '2026-09-20']
    expect(adjacentDays(days, '2026-09-26')).toEqual({ older: '2026-09-20', newer: '2026-09-27' })
    expect(adjacentDays(days, '2026-09-27')).toEqual({ older: '2026-09-26' })
    expect(adjacentDays(days, undefined)).toEqual({})
  })

  it('shows a summary window with its start day only when it began on another day', () => {
    expect(summaryWindow(NOW - HOUR, NOW, clock, t)).toBe('14:30–15:30')
    expect(summaryWindow(NOW - 20 * HOUR, NOW, clock, t)).toBe('9/26 19:30–15:30')
  })
})
