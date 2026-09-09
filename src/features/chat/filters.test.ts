import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  computeExportRange,
  defaultExportMode,
  endOfDay,
  isFiltered,
  parseDateInput,
  parseFilters,
  rangeLabel,
  resolveRange,
  startOfDay,
  toDateInput,
  toListQuery,
  validateCustomRange,
} from './filters'

// 2026-09-05 14:32 local
const NOW = new Date(2026, 8, 5, 14, 32).getTime()
const DAY = 86_400_000

describe('resolveRange', () => {
  it('today starts at local midnight and has no upper bound', () => {
    expect(resolveRange({ preset: 'today' }, NOW)).toEqual({ from: new Date(2026, 8, 5).getTime() })
  })
  it('7d / 30d include today', () => {
    expect(resolveRange({ preset: '7d' }, NOW).from).toBe(startOfDay(NOW) - 6 * DAY)
    expect(resolveRange({ preset: '30d' }, NOW).from).toBe(startOfDay(NOW) - 29 * DAY)
  })
  it('all is unbounded', () => {
    expect(resolveRange({ preset: 'all' }, NOW)).toEqual({})
  })
  it('custom snaps to whole days and tolerates reversed bounds', () => {
    const a = new Date(2026, 3, 22, 10).getTime()
    const b = new Date(2026, 4, 5, 3).getTime()
    expect(resolveRange({ preset: 'custom', from: b, to: a }, NOW)).toEqual({ from: startOfDay(a), to: endOfDay(b) })
  })
})

describe('date inputs', () => {
  it('round-trips YYYY-MM-DD', () => {
    const ms = new Date(2026, 3, 22).getTime()
    expect(toDateInput(ms)).toBe('2026-04-22')
    expect(parseDateInput('2026-04-22')).toBe(ms)
  })
  it('rejects malformed or impossible dates', () => {
    expect(parseDateInput('2026-4-2')).toBeUndefined()
    expect(parseDateInput('2026-02-30')).toBeUndefined()
    expect(parseDateInput('hello')).toBeUndefined()
  })
  it('validateCustomRange enforces order and the future', () => {
    expect(validateCustomRange('2026-04-22', '2026-05-05', NOW)).toMatchObject({ ok: true })
    expect(validateCustomRange('2026-05-05', '2026-04-22', NOW)).toMatchObject({ ok: false, error: '开始日期不能晚于结束日期' })
    expect(validateCustomRange('2027-01-01', '2027-01-02', NOW)).toMatchObject({ ok: false, error: '开始日期不能晚于今天' })
    expect(validateCustomRange('x', '2027-01-02', NOW)).toMatchObject({ ok: false })
  })
})

describe('rangeLabel', () => {
  it('uses preset labels', () => {
    expect(rangeLabel({ preset: 'today' }, NOW)).toBe('今天')
    expect(rangeLabel({ preset: '7d' }, NOW)).toBe('最近 7 天')
    expect(rangeLabel({ preset: 'all' }, NOW)).toBe('全部')
  })
  it('custom ending today reads 至 今天', () => {
    const from = new Date(2026, 3, 22).getTime()
    expect(rangeLabel({ preset: 'custom', from, to: NOW }, NOW)).toBe('2026-04-22 至 今天')
    expect(rangeLabel({ preset: 'custom', from, to: new Date(2026, 4, 5).getTime() }, NOW)).toBe('2026-04-22 至 2026-05-05')
  })
})

describe('parseFilters', () => {
  it('falls back to defaults for garbage', () => {
    expect(parseFilters(undefined)).toEqual(DEFAULT_FILTERS)
    expect(parseFilters({ range: { preset: 'nope' }, senderIds: 'x' })).toEqual(DEFAULT_FILTERS)
    expect(parseFilters({ range: { preset: 'custom', from: 'a', to: 2 } })).toEqual(DEFAULT_FILTERS)
  })
  it('keeps valid state and dedupes senders', () => {
    const parsed = parseFilters({ range: { preset: 'custom', from: 1, to: 2 }, senderIds: ['a', 'b', 'a', 3, ''] })
    expect(parsed).toEqual({ range: { preset: 'custom', from: 1, to: 2 }, senderIds: ['a', 'b'] })
    expect(isFiltered(parsed)).toBe(true)
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false)
  })
})

describe('toListQuery', () => {
  it('omits unset keys so the substrate sees a minimal query', () => {
    expect(toListQuery('s1', DEFAULT_FILTERS, 50, NOW)).toEqual({ sessionId: 's1', limit: 50 })
    const q = toListQuery('s1', { range: { preset: 'today' }, senderIds: ['u1'] }, 20, NOW)
    expect(q).toEqual({ sessionId: 's1', limit: 20, from: startOfDay(NOW), senderIds: ['u1'] })
  })
})

describe('computeExportRange', () => {
  const filters = { range: { preset: 'today' as const }, senderIds: [] }
  it('selected wins and dedupes ids', () => {
    expect(computeExportRange('selected', filters, new Set(['m1', 'm2']), NOW)).toEqual({ messageIds: ['m1', 'm2'] })
    expect(computeExportRange('selected', filters, ['m1', 'm1'], NOW)).toEqual({ messageIds: ['m1'] })
  })
  it('filtered mirrors the tab range, all ignores it', () => {
    expect(computeExportRange('filtered', filters, [], NOW)).toEqual({ from: startOfDay(NOW) })
    expect(computeExportRange('all', filters, [], NOW)).toEqual({})
  })
  it('defaultExportMode prefers selection, then filters', () => {
    expect(defaultExportMode(2, DEFAULT_FILTERS)).toBe('selected')
    expect(defaultExportMode(0, filters)).toBe('filtered')
    expect(defaultExportMode(0, DEFAULT_FILTERS)).toBe('all')
  })
})
