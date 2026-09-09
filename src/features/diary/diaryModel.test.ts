import { describe, expect, it } from 'vitest'
import { diaryDateLabel, diaryTitle, groupByMonth, parseDateKey, pickInitialDate, sourcesSummary, splitCues, todayKey } from './diaryModel'

const item = (date: string, degraded?: boolean) => ({ date, generatedAt: 0, degraded })

describe('groupByMonth', () => {
  it('groups newest-first and drops malformed dates', () => {
    const groups = groupByMonth([item('2026-08-30'), item('2026-09-05'), item('bad'), item('2026-09-01'), item('2025-12-31')])
    expect(groups.map((g) => g.key)).toEqual(['2026-09', '2026-08', '2025-12'])
    expect(groups[0]?.label).toBe('2026 年 9 月')
    expect(groups[0]?.items.map((i) => i.date)).toEqual(['2026-09-05', '2026-09-01'])
  })
  it('is empty for no entries', () => {
    expect(groupByMonth([])).toEqual([])
  })
})

describe('dates', () => {
  it('parses and labels', () => {
    expect(parseDateKey('2026-09-05')).toEqual({ y: 2026, m: 9, d: 5 })
    expect(parseDateKey('2026-13-05')).toBeUndefined()
    expect(diaryDateLabel('2026-09-05')).toBe('9月5日 周六')
    expect(diaryTitle('2026-09-05')).toBe('2026 年 9 月 5 日 · 周六')
    expect(diaryDateLabel('nope')).toBe('nope')
    expect(todayKey(new Date(2026, 0, 3).getTime())).toBe('2026-01-03')
  })
  it('pickInitialDate prefers the requested date, else the newest', () => {
    const items = [item('2026-09-01'), item('2026-09-05')]
    expect(pickInitialDate(items, '2026-09-01')).toBe('2026-09-01')
    expect(pickInitialDate(items, '2026-01-01')).toBe('2026-09-05')
    expect(pickInitialDate([])).toBeUndefined()
  })
})

describe('splitCues', () => {
  const md = ['# 2026-09-05 日记', '', '今天共 128 条消息。', '', '## 会话', '### 产品市场群（40 条）', '- 张明：路演纪要', '', '## 记忆线索', '- 产品市场群：路演纪要', '- 周报要标风险项', ''].join('\n')
  it('strips the cues section and the leading date title', () => {
    const { body, cues } = splitCues(md)
    expect(body.startsWith('今天共 128 条消息。')).toBe(true)
    expect(body).not.toContain('记忆线索')
    expect(cues).toEqual(['产品市场群：路演纪要', '周报要标风险项'])
  })
  it('prefers cues from the entry and tolerates a missing section', () => {
    expect(splitCues(md, ['a', 'b']).cues).toEqual(['a', 'b'])
    expect(splitCues('只有正文', ['x'])).toEqual({ body: '只有正文', cues: ['x'] })
    expect(splitCues('只有正文')).toEqual({ body: '只有正文', cues: [] })
  })
})

describe('sourcesSummary', () => {
  it('formats the meta line', () => {
    const s = sourcesSummary({ generatedAt: 1, sources: { sessions: ['a', 'b'], messageCount: 128, agentTurns: 0 } }, () => '14:32')
    expect(s).toBe('生成于 14:32 · 128 条消息 · 2 个会话')
    expect(sourcesSummary({ generatedAt: 1, sources: { sessions: [], messageCount: 0, agentTurns: 3 } }, () => '02:00')).toContain('3 轮 Agent 对话')
  })
})
