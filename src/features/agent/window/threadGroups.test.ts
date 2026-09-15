import { describe, expect, it } from 'vitest'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import { filterThreads, groupThreads } from './threadGroups'

const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] as string[] }
const NOW = new Date(2026, 8, 14, 12, 0).getTime()
const DAY = 86_400_000
const thread = (id: string, updatedAt: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: id as ThreadId,
  title: id,
  origin: { channel: 'desktop' },
  settings,
  createdAt: updatedAt,
  updatedAt,
  pinned: false,
  ...patch,
})

describe('groupThreads', () => {
  it('puts pinned threads first, then buckets by day, and drops empty groups', () => {
    const groups = groupThreads(
      [
        thread('pinned-old', NOW - 30 * DAY, { pinned: true }),
        thread('today', NOW - 60_000),
        thread('yesterday', NOW - DAY),
        thread('week', NOW - 6 * DAY),
        thread('earlier', NOW - 7 * DAY),
      ],
      NOW,
    )
    expect(groups.map((g) => [g.id, g.threads.map((t) => t.threadId)])).toEqual([
      ['pinned', ['pinned-old']],
      ['today', ['today']],
      ['yesterday', ['yesterday']],
      ['week', ['week']],
      ['earlier', ['earlier']],
    ])
    expect(groupThreads([thread('a', NOW)], NOW).map((g) => g.id)).toEqual(['today'])
    expect(groupThreads([], NOW)).toEqual([])
  })
})

describe('filterThreads', () => {
  const all = [
    thread('a', NOW, { title: '产品市场群 周报' }),
    thread('b', NOW, { title: '', contextRef: { kind: 'session', id: 's1', label: '投研交流群' } }),
    thread('c', NOW, { title: 'Weekly Report' }),
  ]
  it('matches the shown title or the context label, case-insensitively', () => {
    expect(filterThreads(all, '周报', '新会话').map((t) => t.threadId)).toEqual(['a'])
    expect(filterThreads(all, '投研', '新会话').map((t) => t.threadId)).toEqual(['b'])
    expect(filterThreads(all, 'weekly', '新会话').map((t) => t.threadId)).toEqual(['c'])
  })
  it('lets an untitled thread match the placeholder title and returns everything for a blank query', () => {
    expect(filterThreads(all, '新会话', '新会话').map((t) => t.threadId)).toEqual(['b'])
    expect(filterThreads(all, '  ', '新会话')).toHaveLength(3)
  })
})
