import { describe, expect, it } from 'vitest'
import type { CloneStatus } from '@aiwc/protocol'
import { buildSteps, cloneStatusLine, filterContacts, formatElapsed, formatEta, progressPercent, rangeToQuery, readyCount, viewFor } from './cloneView'

const none: CloneStatus = { state: 'none', messageCount: 1284 }
const building: CloneStatus = { state: 'building', progress: { done: 2, total: 5, step: '提炼事实', startedAt: 0, etaMs: 70_000 } }
const ready: CloneStatus = { state: 'ready', version: 2, sampleCount: 38, builtAt: 0 }
const failed: CloneStatus = { state: 'failed', error: 'timeout', kind: 'model' }

describe('viewFor', () => {
  it('maps every status to a view', () => {
    expect(viewFor(none)).toBe('idle')
    expect(viewFor(building)).toBe('building')
    expect(viewFor(ready)).toBe('ready')
    expect(viewFor(failed)).toBe('failed')
    expect(viewFor(undefined)).toBe('idle')
  })
})

describe('cloneStatusLine', () => {
  it('writes the list second line per status', () => {
    expect(cloneStatusLine(none)).toEqual({ text: '未克隆 · 1,284 条消息', tone: 'neutral' })
    expect(cloneStatusLine(building)).toEqual({ text: '克隆中 · 40% · 约 2 分钟', tone: 'accent' })
    expect(cloneStatusLine(ready)).toEqual({ text: '已克隆 · v2 · 38 个样本', tone: 'ok' })
    expect(cloneStatusLine(failed)).toEqual({ text: '失败 · 模型错误', tone: 'danger' })
    expect(cloneStatusLine(undefined, 61).text).toBe('未克隆 · 61 条消息')
  })
})

describe('progress helpers', () => {
  it('clamps percentages', () => {
    expect(progressPercent({ done: 0, total: 0 })).toBe(0)
    expect(progressPercent({ done: 3, total: 4 })).toBe(75)
    expect(progressPercent({ done: 9, total: 4 })).toBe(100)
  })
  it('formats eta and elapsed', () => {
    expect(formatEta(undefined)).toBe('')
    expect(formatEta(3_000)).toBe('即将完成')
    expect(formatEta(42_000)).toBe('约 50 秒')
    expect(formatEta(150_000)).toBe('约 3 分钟')
    expect(formatElapsed(72_000)).toBe('1 分 12 秒')
    expect(formatElapsed(9_500)).toBe('9 秒')
  })
  it('builds the step list around the current step', () => {
    const steps = buildSteps({ done: 1, total: 4, step: '提炼说话风格' })
    expect(steps).toHaveLength(4)
    expect(steps.map((s) => s.status)).toEqual(['done', 'doing', 'todo', 'todo'])
    expect(steps[1]?.label).toBe('提炼说话风格')
    expect(buildSteps({ done: 4, total: 4, step: '' }).every((s) => s.status === 'done')).toBe(true)
  })
})

describe('list filters', () => {
  const entries = [
    { contactId: 'wxid_a', displayName: '李娜', status: ready, messageCount: 10 },
    { contactId: 'wxid_b', displayName: '张明', status: none, messageCount: 20 },
    { contactId: 'wxid_c', displayName: 'Brooklyn', status: building, messageCount: 30 },
  ]
  it('filters by segment and query', () => {
    expect(filterContacts(entries, '', 'all')).toHaveLength(3)
    expect(filterContacts(entries, '', 'ready').map((e) => e.contactId)).toEqual(['wxid_a'])
    expect(filterContacts(entries, 'brook', 'all').map((e) => e.contactId)).toEqual(['wxid_c'])
    expect(filterContacts(entries, 'wxid_b', 'all')).toHaveLength(1)
    expect(readyCount(entries)).toBe(1)
  })
  it('converts training ranges', () => {
    const now = 1_000_000_000_000
    expect(rangeToQuery('all', now)).toBeUndefined()
    expect(rangeToQuery('year', now)).toEqual({ from: now - 365 * 86_400_000, to: now })
    expect(rangeToQuery('quarter', now)?.from).toBe(now - 90 * 86_400_000)
  })
})
