/**
 * Pure helpers for the diary Tab: month grouping of the date list, splitting the `## 记忆线索` section
 * out of the markdown, date labels. Tested in diaryModel.test.ts.
 */
import type { DiaryEntry } from '@aiwc/protocol'

export type DiaryListItem = Pick<DiaryEntry, 'date' | 'generatedAt' | 'degraded'>

export interface MonthGroup {
  /** YYYY-MM */
  key: string
  /** 2026 年 9 月 */
  label: string
  /** newest first */
  items: DiaryListItem[]
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad2 = (n: number) => String(n).padStart(2, '0')

export function parseDateKey(date: string): { y: number; m: number; d: number } | undefined {
  const m = DATE_RE.exec(date)
  if (!m) return undefined
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  return { y, m: mo, d }
}

export function todayKey(now: number = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Group by month, newest month and newest day first; malformed dates are dropped. */
export function groupByMonth(items: readonly DiaryListItem[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>()
  for (const item of items) {
    const p = parseDateKey(item.date)
    if (!p) continue
    const key = `${p.y}-${pad2(p.m)}`
    const g = groups.get(key) ?? { key, label: `${p.y} 年 ${p.m} 月`, items: [] }
    g.items.push(item)
    groups.set(key, g)
  }
  const out = [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : -1))
  for (const g of out) g.items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return out
}

/** 9月5日 周六 */
export function diaryDateLabel(date: string): string {
  const p = parseDateKey(date)
  if (!p) return date
  const wd = WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()] ?? ''
  return `${p.m}月${p.d}日 ${wd}`.trim()
}

/** 2026 年 9 月 5 日 · 周六 */
export function diaryTitle(date: string): string {
  const p = parseDateKey(date)
  if (!p) return date
  const wd = WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()] ?? ''
  return `${p.y} 年 ${p.m} 月 ${p.d} 日 · ${wd}`
}

const CUES_HEADING_RE = /^\s{0,3}#{1,6}\s*记忆线索\s*$/m

/**
 * Split the trailing `## 记忆线索` section (ARCHITECTURE §8) off the body. Cues come from the entry when
 * present, otherwise from the section's bullet lines.
 */
export function splitCues(markdown: string, knownCues?: readonly string[]): { body: string; cues: string[] } {
  const m = CUES_HEADING_RE.exec(markdown)
  if (!m) return { body: markdown.trim(), cues: [...(knownCues ?? [])] }
  const body = markdown.slice(0, m.index).trim()
  const section = markdown.slice(m.index + m[0].length)
  const parsed = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*+]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map((l) => l.replace(/^([-*+]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
  const cues = knownCues && knownCues.length ? [...knownCues] : parsed
  return { body: stripLeadingTitle(body), cues }
}

/** The reader shows its own date header, so drop a leading `# YYYY-MM-DD 日记` line. */
function stripLeadingTitle(body: string): string {
  return body.replace(/^\s{0,3}#\s+\d{4}-\d{2}-\d{2}[^\n]*\n?/, '').trim()
}

/** Which date the reader opens with: the requested one when it exists, otherwise the newest. */
export function pickInitialDate(items: readonly DiaryListItem[], requested?: string): string | undefined {
  if (requested && items.some((i) => i.date === requested)) return requested
  return [...items].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.date
}

/** 生成于 14:32 · 128 条消息 · 6 个会话 */
export function sourcesSummary(entry: Pick<DiaryEntry, 'sources' | 'generatedAt'>, clock: (ms: number) => string): string {
  const parts = [`生成于 ${clock(entry.generatedAt)}`, `${entry.sources.messageCount} 条消息`, `${entry.sources.sessions.length} 个会话`]
  if (entry.sources.agentTurns > 0) parts.push(`${entry.sources.agentTurns} 轮 Agent 对话`)
  return parts.join(' · ')
}
