/**
 * Candidates for the `@` popover: sessions and contacts from the substrate, open file tabs from the
 * workspace, and the four memory files. Injected into the Composer so the clone page (or tests) can
 * supply their own.
 */
import { MEMORY_FILES, type Mention, type MentionKind, type MemoryFile } from '@aiwc/protocol'
import { t, type MessageKey } from '@/i18n'
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

export const MENTION_TABS: ReadonlyArray<{ value: MentionKind; labelKey: MessageKey }> = [
  { value: 'session', labelKey: 'agent.mention.tabs.session' },
  { value: 'file', labelKey: 'agent.mention.tabs.file' },
  { value: 'contact', labelKey: 'agent.mention.tabs.contact' },
  { value: 'memory', labelKey: 'agent.mention.tabs.memory' },
]

const MEMORY_FILE_SUBTITLE: Record<MemoryFile, MessageKey> = {
  MEMORY: 'agent.mention.memoryFile.memory',
  USER: 'agent.mention.memoryFile.user',
  SOUL: 'agent.mention.memoryFile.soul',
  AGENTS: 'agent.mention.memoryFile.agents',
}

const SESSION_KIND_LABEL = {
  dm: 'agent.mention.sessionKind.dm',
  group: 'agent.mention.sessionKind.group',
  official: 'agent.mention.sessionKind.official',
  system: 'agent.mention.sessionKind.system',
} as const
const CONTACT_KIND_LABEL = {
  friend: 'agent.mention.contactKind.friend',
  group: 'agent.mention.contactKind.group',
  official: 'agent.mention.contactKind.official',
  stranger: 'agent.mention.contactKind.stranger',
} as const

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
          subtitle: [
            t(SESSION_KIND_LABEL[s.kind]),
            s.indexedCount !== undefined ? t('agent.mention.indexedCount', { n: s.indexedCount }) : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
        }))
      }
      case 'contact': {
        const { items } = await invoke('substrate:listContacts', { query: query || undefined, kind: 'all', limit })
        return items.map((c) => ({
          kind: 'contact',
          id: c.username,
          label: c.remark || c.nickname,
          subtitle: [t(CONTACT_KIND_LABEL[c.kind]), c.remark ? c.nickname : undefined].filter(Boolean).join(' · '),
        }))
      }
      case 'file':
        return openFileTabs()
          .filter((tab) => matchesQuery(query, tab.title, tab.objectId))
          .map((tab) => ({
            kind: 'file',
            id: tab.objectId,
            label: tab.title,
            subtitle: tab.dirty ? t('agent.mention.openTabModified') : t('agent.mention.openTab'),
          }))
      case 'memory':
        return MEMORY_FILES.filter((file) => matchesQuery(query, file, t(MEMORY_FILE_SUBTITLE[file]))).map((file) => ({
          kind: 'memory',
          id: file,
          label: `${file}.md`,
          subtitle: t(MEMORY_FILE_SUBTITLE[file]),
        }))
    }
  },
}
