/**
 * memory:* (four localStorage-backed Markdown files, seeded from the dataset) and diary:*
 * (generated from the messages of the requested day, with progress events).
 */
import type { DiaryEntry, MemoryEntry, MemoryFile, WxMessage } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'
import { localDateKey, searchableText } from './dataset'

const MEMORY_KEY = (file: MemoryFile) => `aiwc.mock.memory.${file}`
const LIMITS: Record<MemoryFile, number> = { MEMORY: 8000, USER: 4000, SOUL: 4000, AGENTS: 6000 }
const DIARY_STEPS = ['选材', '会话小结', '日综合', '写入'] as const

export function memoryHandlers(ctx: MockContext): HandlersFor<'memory'> & HandlersFor<'diary'> {
  const { data } = ctx
  const diaries = new Map<string, DiaryEntry>()

  function seed(file: MemoryFile): string {
    const sessions = [...data.sessions.values()]
    const busiest = [...sessions].sort((a, b) => (b.indexedCount ?? 0) - (a.indexedCount ?? 0))
    const topDm = busiest.find((s) => s.kind === 'dm')
    const topGroups = busiest.filter((s) => s.kind === 'group').slice(0, 3)
    switch (file) {
      case 'MEMORY':
        return [
          '# MEMORY',
          '',
          topDm ? `- 最近和「${topDm.title}」聊得最多（近 90 天 ${topDm.indexedCount ?? 0} 条）。` : '',
          topGroups.length ? `- 常在的群：${topGroups.map((g) => `「${g.title}」`).join('、')}。` : '',
          '- 用户希望回答简短，引用聊天记录时给出来源。',
        ]
          .filter(Boolean)
          .join('\n')
      case 'USER':
        return ['# USER', '', `- 微信昵称：${data.account.nickname ?? data.account.wxid}。`, `- 有 ${data.contactList.length} 个联系人，${sessions.filter((s) => s.kind === 'group').length} 个群。`].join('\n')
      case 'SOUL':
        return ['# SOUL', '', '- 说话简短、直接，中文优先。', '- 引用聊天记录时给出来源（会话 · 时间）。', '- 不确定时先问一句，不猜。'].join('\n')
      case 'AGENTS':
        return ['# AGENTS', '', '- 涉及发送、推送前必须确认。', '- 不要把聊天记录发给第三方服务。', '- 生成文件时用 Markdown，标题用中文。'].join('\n')
    }
  }

  const read = (file: MemoryFile): string => ctx.kv.get<string | null>(MEMORY_KEY(file), null) ?? seed(file)
  const write = (file: MemoryFile, markdown: string, source: MemoryEntry['source']) => {
    ctx.kv.set(MEMORY_KEY(file), markdown)
    ctx.emit('memory:changed', { file, source })
  }

  function entries(file: MemoryFile): MemoryEntry[] {
    return read(file)
      .split('\n')
      .filter((line) => /^\s*[-*]\s+/.test(line))
      .map((line, index) => ({ index, text: line.replace(/^\s*[-*]\s+/, '').trim(), source: 'user' as const }))
  }

  function messagesOn(date: string): WxMessage[] {
    const out: WxMessage[] = []
    for (const list of data.messagesBySession.values()) for (const m of list) if (localDateKey(m.createdAt) === date) out.push(m)
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }

  function buildDiary(date: string): DiaryEntry {
    const msgs = messagesOn(date)
    const bySession = new Map<string, WxMessage[]>()
    for (const m of msgs) {
      const l = bySession.get(m.sessionId) ?? []
      l.push(m)
      bySession.set(m.sessionId, l)
    }
    if (msgs.length === 0) {
      return { date, markdown: `# ${date} 日记\n\n今天没有可用的聊天记录。\n\n## 记忆线索\n- 今天没有新的聊天记录。`, cues: ['今天没有新的聊天记录。'], sources: { sessions: [], messageCount: 0, agentTurns: 0 }, generatedAt: ctx.now(), degraded: true }
    }
    const ranked = [...bySession.entries()].sort((a, b) => b[1].length - a[1].length)
    const sections = ranked.slice(0, 6).map(([sid, list]) => {
      const title = data.sessions.get(sid)?.title ?? sid
      const lines = list.filter((m) => searchableText(m).length > 3).slice(0, 3).map((m) => `- ${m.senderName ?? '对方'}：${searchableText(m).slice(0, 50)}`)
      return `### ${title}（${list.length} 条）\n${lines.join('\n') || '- （多为图片、表情或语音）'}`
    })
    const cues = ranked.slice(0, 8).map(([sid, list]) => {
      const title = data.sessions.get(sid)?.title ?? sid
      const first = list.find((m) => searchableText(m).length > 3)
      return `${title}：${first ? searchableText(first).slice(0, 24) : `${list.length} 条消息`}`
    })
    while (cues.length < 3) cues.push(`共 ${msgs.length} 条消息，${bySession.size} 个会话有往来。`)
    const markdown = [`# ${date} 日记`, '', `今天共 ${msgs.length} 条消息，涉及 ${bySession.size} 个会话。`, '', '## 会话', ...sections, '', '## 记忆线索', ...cues.map((c) => `- ${c}`)].join('\n')
    return { date, markdown, cues, sources: { sessions: ranked.map(([sid]) => sid), messageCount: msgs.length, agentTurns: 0 }, generatedAt: ctx.now() }
  }

  return {
    'memory:read': ({ file }) => read(file),
    'memory:write': ({ file, markdown }) => {
      if (markdown.length > LIMITS[file]) throw new Error(`超出 ${file} 的容量上限（${LIMITS[file]} 字）`)
      write(file, markdown, 'user')
    },
    'memory:entries': ({ file }) => entries(file),
    'memory:budget': ({ file }) => ({ file, usedChars: read(file).length, limitChars: LIMITS[file] }),
    'memory:clear': ({ file }) => write(file, '', 'user'),

    'diary:list': () =>
      [...diaries.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map(({ date, generatedAt, degraded }) => ({ date, generatedAt, degraded })),
    'diary:get': ({ date }) => diaries.get(date),
    'diary:generate': async ({ date, force }) => {
      const existing = diaries.get(date)
      if (existing && !force) return existing
      for (let i = 0; i < DIARY_STEPS.length; i++) {
        ctx.emit('diary:progress', { date, step: DIARY_STEPS[i] as string, fraction: i / DIARY_STEPS.length })
        await ctx.delay(700)
      }
      const entry = buildDiary(date)
      diaries.set(date, entry)
      ctx.emit('diary:progress', { date, step: '完成', fraction: 1 })
      ctx.emit('memory:changed', { file: 'MEMORY', source: 'diary' })
      return entry
    },
  }
}
