/**
 * Chinese prompts for the diary pipeline and the parser for the synthesis output.
 * Output contract of the synthesis call:
 *   ## 今天 / ## 人 / ## 待办 / ## 一句话   (first-person diary, 300–600 字)
 *   ## 记忆线索                             (3–8 bullets: names, topics, dates, places)
 *   ## 稳定事实                             (optional, ≤3 bullets; stripped from the diary and fed to MEMORY)
 */
import type { SessionKind } from '@aiwc/protocol'
import { splitCues } from './diaryStore'

export const DIARY_MIN_CUES = 3
export const DIARY_MAX_CUES = 8
export const DIARY_MAX_FACTS = 3
export const FACTS_HEADING = '## 稳定事实'
const FACTS_HEADING_RE = /^##\s*稳定事实\s*$/gm
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)、])\s+(.*\S)\s*$/

const kindLabel = (k: SessionKind) => (k === 'group' ? '群聊' : k === 'official' ? '公众号' : '私聊')

export function sessionSummarySystem(title: string, kind: SessionKind, windowLabel: string): string {
  return [
    `你是用户的私人日记助手。下面是用户与「${title}」（${kindLabel(kind)}）在 ${windowLabel} 期间的微信聊天节选，「我」是用户本人。`,
    '请用不超过 120 字的中文概括三点：发生了什么、有没有待办（没有就不提）、整体情绪。',
    '只依据聊天内容，不要臆造，不要评价。输出一段纯文本，不要标题、列表或引号。',
  ].join('\n')
}

export function sessionSummaryUser(title: string, count: number, transcript: string): string {
  return `【${title}】本时段共 ${count} 条消息，以下为节选：\n${transcript}`
}

export function synthesisSystem(date: string, customPrompt?: string): string {
  const lines = [
    `你是用户本人，正在写 ${date} 的日记。素材是当天各个微信会话的小结，可能还有与 AI 助手对话的摘要。`,
    '要求：',
    '1. 第一人称、口语、真诚，像写给自己看的日记，不要写成工作汇报或新闻稿；',
    '2. 全文 300–600 字，用以下四个二级标题依次组织：## 今天、## 人、## 待办、## 一句话；',
    '3. 只写素材里有的事，人名和事件保持原样，不要编造细节；素材少就写短一点；',
    `4. 正文之后必须有 ## 记忆线索 段，其下 ${DIARY_MIN_CUES}–${DIARY_MAX_CUES} 个要点，每条一行、以“- ”开头，写日后便于检索的人名、话题、日期、地点等关键词；`,
    `5. 若素材里出现明确、长期稳定的新事实（某人换了工作、生日、固定安排、重要偏好），可在最后追加 ${FACTS_HEADING} 段，最多 ${DIARY_MAX_FACTS} 条、每条不超过 60 字，只写有把握的，不确定就不要这一段。`,
    '不要输出代码围栏或额外说明。',
  ]
  const custom = customPrompt?.trim()
  if (custom) lines.push('', '用户的额外要求：', custom)
  return lines.join('\n')
}

export interface SynthesisInput {
  date: string
  summaries: Array<{ title: string; kind: SessionKind; count: number; text: string }>
  agentDigest?: string
}

export function synthesisUser(input: SynthesisInput): string {
  const parts = [`日期：${input.date}`, '', '【会话小结】']
  for (const s of input.summaries) parts.push(`- ${s.title}（${kindLabel(s.kind)} · ${s.count} 条）：${s.text}`)
  if (input.agentDigest) parts.push('', '【与 AI 助手的对话摘要】', input.agentDigest)
  parts.push('', '请按要求写今天的日记。')
  return parts.join('\n')
}

export interface ParsedSynthesis {
  body: string
  cues: string[]
  facts: string[]
}

function bulletsAfter(text: string, headingRe: RegExp): { before: string; bullets: string[] } {
  let idx = -1
  for (const m of text.matchAll(headingRe)) idx = m.index ?? idx
  if (idx < 0) return { before: text, bullets: [] }
  const bullets: string[] = []
  for (const line of text.slice(idx).split('\n').slice(1)) {
    if (/^##?\s/.test(line)) break
    const m = line.match(BULLET_RE)
    if (m?.[1]) bullets.push(m[1].trim())
  }
  return { before: text.slice(0, idx).trimEnd(), bullets }
}

/** Parse the synthesis output. Throws when there is no usable body (caller degrades). */
export function parseSynthesis(raw: string): ParsedSynthesis {
  let text = raw.replace(/\r\n/g, '\n').trim()
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i)
  if (fence?.[1]) text = fence[1].trim()
  const { before, bullets: facts } = bulletsAfter(text, FACTS_HEADING_RE)
  const { body, cues } = splitCues(before)
  if (body.replace(/\s+/g, '').length < 20) throw new Error('日记正文为空或过短')
  return {
    body,
    cues: dedupe(cues).slice(0, DIARY_MAX_CUES),
    facts: dedupe(facts)
      .map((f) => f.slice(0, 60))
      .slice(0, DIARY_MAX_FACTS),
  }
}

export function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const it of items) {
    const k = it.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(it.trim())
  }
  return out
}

/** Fill cues up to the minimum with deterministic fallbacks (session titles, then the date). */
export function padCues(cues: readonly string[], fallbacks: readonly string[], date: string): string[] {
  const out = dedupe(cues)
  for (const f of fallbacks) {
    if (out.length >= DIARY_MIN_CUES) break
    if (!out.some((c) => c.toLowerCase() === f.toLowerCase())) out.push(f)
  }
  for (const extra of [date, `${date} 日记`]) if (out.length < DIARY_MIN_CUES && !out.includes(extra)) out.push(extra)
  return out.slice(0, DIARY_MAX_CUES)
}

export interface DegradedInput {
  date: string
  reason: string
  sections: Array<{ title: string; kind: SessionKind; count: number; text: string; isSummary: boolean }>
  agentDigest?: string
}

/** Diary assembled without the synthesis call: per-session summaries or raw excerpts. */
export function renderDegraded(input: DegradedInput): string {
  const parts = [`> 降级版日记：${input.reason}。以下按会话整理，未经综合。`, '', '## 今天']
  for (const s of input.sections) {
    parts.push('', `### ${s.title}（${kindLabel(s.kind)} · ${s.count} 条${s.isSummary ? '' : ' · 原始摘录'}）`, s.text)
  }
  if (input.agentDigest) parts.push('', '## 与 AI 助手的对话', input.agentDigest)
  return parts.join('\n')
}
