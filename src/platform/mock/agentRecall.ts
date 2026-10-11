/**
 * The mock agent's recall over the canned dataset: the search keyword it pulls out of a request, the messages it
 * finds, and how it cites them. Split out of agent.ts so that file stays under the line ceiling (AGENTS.md §2.3).
 */
import { formatCitation, type Mention, type WxMessage } from '@aiwc/protocol'
import { searchableText, type DatasetIndex } from './dataset'

const FILLER_WORDS =
  /(帮我|请你|请|一下|看看|找找|找出|找|搜索|搜一搜|搜|查询|查一查|查|总结|整理|统计|告诉我|关于|的消息|的记录|的聊天|有没有|哪些|什么|最近|一周|上周|这周|上个月|这个月|里|吗|呢)/g

/** Pull a search keyword out of a Chinese request: drop request verbs / fillers, keep the topic. */
export function deriveQuery(text: string, mentions: Mention[]): string {
  const cleaned = text
    .replace(FILLER_WORDS, ' ')
    .replace(/[，。！？、；：“”‘’（）「」,.!?;:()\s]+/g, ' ')
    .trim()
  const tokens = cleaned.split(' ').filter((t) => t.length >= 2)
  const pick = tokens.find((t) => t.length <= 8) ?? tokens[0]
  if (pick) return pick.slice(0, 8)
  const fallback = text.replace(/\s+/g, '').slice(0, 8)
  return fallback || mentions[0]?.label || '最近'
}

/** Same citation dialect as the real tools (`cite`), so the preview exercises the panel's citation chips. */
export function describeMessage(data: DatasetIndex, m: WxMessage): string {
  const session = data.sessions.get(m.sessionId)
  const d = new Date(m.createdAt)
  const p = (x: number) => String(x).padStart(2, '0')
  const cite = formatCitation(
    m.anchor ?? { sessionId: m.sessionId, messageId: m.id },
    `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
  )
  return `${m.senderName ?? '对方'}（${session?.title ?? m.sessionId}）：“${searchableText(m).slice(0, 40)}” ${cite}`
}

/** Newest-first substring search over the canned chats (the mock agent's stand-in for search_messages). */
export function searchMessages(data: DatasetIndex, query: string, sessionIds: string[] | undefined): WxMessage[] {
  const needle = query.toLowerCase()
  const scope = sessionIds && sessionIds.length ? sessionIds : [...data.sessions.keys()]
  const hits: WxMessage[] = []
  for (const sid of scope)
    for (const m of data.messagesBySession.get(sid) ?? [])
      if (searchableText(m).toLowerCase().includes(needle)) hits.push(m)
  return hits.sort((a, b) => b.createdAt - a.createdAt)
}
