/**
 * Candidates for the `@` popover: sessions and contacts from the substrate, open file tabs from the
 * workspace, and the four memory files. Injected into the Composer so the clone page (or tests) can
 * supply their own.
 */
import type { Mention, MentionKind, MemoryFile } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'
import { openFileTabs } from './contextRef'
import { matchesQuery } from './mentions'

export interface MentionCandidate extends Mention {
  /** second line, 12 weak */
  subtitle?: string
}

export interface MentionSources {
  search(kind: MentionKind, query: string): Promise<MentionCandidate[]>
}

export const MENTION_TABS: ReadonlyArray<{ value: MentionKind; label: string }> = [
  { value: 'session', label: '会话' },
  { value: 'file', label: '文件' },
  { value: 'contact', label: '联系人' },
  { value: 'memory', label: '记忆' },
]

const MEMORY_FILES: ReadonlyArray<{ file: MemoryFile; subtitle: string }> = [
  { file: 'MEMORY', subtitle: '当下事实' },
  { file: 'USER', subtitle: '我是谁' },
  { file: 'SOUL', subtitle: 'Agent 人格' },
  { file: 'AGENTS', subtitle: '工作规则' },
]

const SESSION_KIND_LABEL = { dm: '单聊', group: '群聊', official: '公众号', system: '系统' } as const
const CONTACT_KIND_LABEL = { friend: '好友', group: '群聊', official: '公众号', stranger: '非好友' } as const

export const defaultMentionSources: MentionSources = {
  async search(kind, query) {
    const limit = 20
    switch (kind) {
      case 'session': {
        const { items } = await invoke('substrate:listSessions', { query: query || undefined, limit })
        return items.map((s) => ({
          kind: 'session',
          id: s.id,
          label: s.title,
          subtitle: [SESSION_KIND_LABEL[s.kind], s.indexedCount !== undefined ? `已索引 ${s.indexedCount} 条` : undefined].filter(Boolean).join(' · '),
        }))
      }
      case 'contact': {
        const { items } = await invoke('substrate:listContacts', { query: query || undefined, kind: 'all', limit })
        return items.map((c) => ({ kind: 'contact', id: c.username, label: c.remark || c.nickname, subtitle: [CONTACT_KIND_LABEL[c.kind], c.remark ? c.nickname : undefined].filter(Boolean).join(' · ') }))
      }
      case 'file':
        return openFileTabs()
          .filter((t) => matchesQuery(query, t.title, t.objectId))
          .map((t) => ({ kind: 'file', id: t.objectId, label: t.title, subtitle: t.dirty ? '中间标签页 · 已修改' : '中间标签页' }))
      case 'memory':
        return MEMORY_FILES.filter((m) => matchesQuery(query, m.file, m.subtitle)).map((m) => ({ kind: 'memory', id: m.file, label: `${m.file}.md`, subtitle: m.subtitle }))
    }
  },
}
