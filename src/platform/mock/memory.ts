/** memory:* — four localStorage-backed Markdown files, seeded from the dataset. */
import type { MemoryEntry, MemoryFile } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const MEMORY_KEY = (file: MemoryFile) => `aiwc.mock.memory.${file}`
const LIMITS: Record<MemoryFile, number> = { MEMORY: 8000, USER: 4000, SOUL: 4000, AGENTS: 6000 }

export function memoryHandlers(ctx: MockContext): HandlersFor<'memory'> {
  const { data } = ctx

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
        return [
          '# USER',
          '',
          `- 微信昵称：${data.account.nickname ?? data.account.wxid}。`,
          `- 有 ${data.contactList.length} 个联系人，${sessions.filter((s) => s.kind === 'group').length} 个群。`,
        ].join('\n')
      case 'SOUL':
        return [
          '# SOUL',
          '',
          '- 说话简短、直接，中文优先。',
          '- 引用聊天记录时给出来源（会话 · 时间）。',
          '- 不确定时先问一句，不猜。',
        ].join('\n')
      case 'AGENTS':
        return [
          '# AGENTS',
          '',
          '- 涉及发送、推送前必须确认。',
          '- 不要把聊天记录发给第三方服务。',
          '- 生成文件时用 Markdown，标题用中文。',
        ].join('\n')
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

  return {
    'memory:read': ({ file }) => read(file),
    'memory:write': ({ file, markdown }) => {
      if (markdown.length > LIMITS[file]) throw new Error(`超出 ${file} 的容量上限（${LIMITS[file]} 字）`)
      write(file, markdown, 'user')
    },
    'memory:entries': ({ file }) => entries(file),
    'memory:budget': ({ file }) => ({ file, usedChars: read(file).length, limitChars: LIMITS[file] }),
    'memory:clear': ({ file }) => write(file, '', 'user'),
  }
}
