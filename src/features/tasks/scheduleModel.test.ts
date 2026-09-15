import { describe, expect, it } from 'vitest'
import type { ScheduledTask } from '@aiwc/protocol'
import { t } from '@/i18n'
import {
  describeSchedule,
  draftFromTask,
  emptyDraft,
  filterTasks,
  sameDraft,
  scheduleOfKind,
  segmentCounts,
  taskStatusLine,
  templateCopy,
  validateDraft,
} from './scheduleModel'

const task = (patch: Partial<ScheduledTask>): ScheduledTask => ({
  id: 't1',
  name: '晨报',
  prompt: '汇总',
  schedule: { kind: 'daily', time: '08:30' },
  enabled: true,
  permissionMode: 'bypass',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

describe('describeSchedule', () => {
  it('words every schedule kind and collapses a full week into 每天', () => {
    expect(describeSchedule({ kind: 'daily', time: '08:30' }, t)).toBe('每天 08:30')
    expect(describeSchedule({ kind: 'weekly', days: [3, 1], time: '09:00' }, t)).toBe('每周一、三 09:00')
    expect(describeSchedule({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' }, t)).toBe('每天 09:00')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 300 }, t)).toBe('每 5 小时')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 45 }, t)).toBe('每 45 分钟')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 2880 }, t)).toBe('每 2 天')
    expect(describeSchedule({ kind: 'cron', expression: '0 0 */5 * * *' }, t)).toBe('Cron 0 0 */5 * * *')
  })
})

describe('draft', () => {
  it('starts from a template and keeps the time of day across kind switches', () => {
    const draft = emptyDraft({
      id: 'x',
      prompt: 'p',
      schedule: { kind: 'weekly', days: [1], time: '07:15' },
      permissionMode: 'autopilot',
    })
    expect(draft).toMatchObject({ name: '', prompt: 'p', enabled: true, permissionMode: 'autopilot' })
    expect(emptyDraft().permissionMode).toBe('bypass')
    expect(scheduleOfKind('daily', draft.schedule)).toEqual({ kind: 'daily', time: '07:15' })
    expect(scheduleOfKind('interval', draft.schedule)).toEqual({ kind: 'interval', everyMinutes: 300 })
    expect(scheduleOfKind('weekly', { kind: 'daily', time: '10:00' })).toEqual({
      kind: 'weekly',
      days: [1, 2, 3, 4, 5],
      time: '10:00',
    })
  })

  it('validates the fields the kind needs and nothing else', () => {
    expect(validateDraft({ ...emptyDraft(), name: 'a', prompt: 'b' }, t)).toEqual({})
    expect(validateDraft(emptyDraft(), t)).toEqual({ name: '请填写任务名称', prompt: '请填写 Agent 指令' })
    expect(
      validateDraft(
        { ...emptyDraft(), name: 'a', prompt: 'b', schedule: { kind: 'weekly', days: [], time: '25:00' } },
        t,
      ),
    ).toEqual({
      time: '请选择时间',
      weekdays: '至少选一天',
    })
    expect(
      validateDraft({ ...emptyDraft(), name: 'a', prompt: 'b', schedule: { kind: 'cron', expression: '* *' } }, t),
    ).toEqual({
      cron: 'Cron 表达式无效',
    })
  })

  it('compares drafts field by field', () => {
    const a = draftFromTask(task({}))
    const b = draftFromTask(task({}))
    expect(sameDraft(a, b)).toBe(true)
    expect(sameDraft(a, { ...b, name: 'x' })).toBe(false)
    expect(sameDraft(a, { ...b, permissionMode: 'autopilot' })).toBe(false)
    expect(sameDraft(a, { ...b, model: { providerId: 'p', modelId: 'm' } })).toBe(false)
  })
})

describe('list helpers', () => {
  const now = Date.UTC(2026, 8, 13, 12, 0)
  it('describes the row status by priority: running > paused > failed > next', () => {
    expect(taskStatusLine(task({ running: true }), t, now).kind).toBe('running')
    expect(taskStatusLine(task({ enabled: false }), t, now)).toEqual({ kind: 'paused', text: '已暂停' })
    expect(
      taskStatusLine(task({ lastRunStatus: 'failed', lastRunAt: now - 60_000, nextRunAt: now + 3600_000 }), t, now)
        .kind,
    ).toBe('failed')
    expect(taskStatusLine(task({ nextRunAt: now + 3600_000 }), t, now).text).toMatch(/^下次 /)
    expect(taskStatusLine(task({}), t, now).text).toBe('尚未运行')
  })

  it('filters by segment and query and counts segments', () => {
    const list = [task({ id: 'a', name: '晨报' }), task({ id: 'b', name: '飞书表格', enabled: false, prompt: 'push' })]
    expect(filterTasks(list, '', 'all').map((x) => x.id)).toEqual(['a', 'b'])
    expect(filterTasks(list, '', 'paused').map((x) => x.id)).toEqual(['b'])
    expect(filterTasks(list, 'PUSH', 'all').map((x) => x.id)).toEqual(['b'])
    expect(segmentCounts(list)).toEqual({ all: 2, on: 1, paused: 1 })
  })

  it('names known templates and falls back to the id', () => {
    expect(templateCopy('feishu-table', t).name).toBe('群聊汇总到飞书')
    expect(templateCopy('unknown', t)).toEqual({ name: 'unknown', description: '' })
  })
})
