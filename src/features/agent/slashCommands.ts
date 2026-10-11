/**
 * Local `/` commands — handled here without a model turn, in the panel and the Agent window alike (both submit
 * through ThreadComposer): `/compact [保留…]`, `/new [text]`, `/export`, `/clear`. Each opens the same dialog as its
 * menu entry (CLAUDE.md §3.7: one confirmation per action, whatever the entry point). Any other `/x` is sent as
 * text: the kernel loads the skill when `x` names one, otherwise it is an ordinary message.
 */
import { parseSlashCommand, type SkillSummary } from '@aiwc/protocol'
import { t, type MessageKey, type Translator } from '@/i18n'
import { toast } from '@/kit'
import type { AgentSurface } from './useAgentSurface'

export const LOCAL_COMMANDS = ['compact', 'new', 'export', 'clear'] as const
export type LocalCommand = (typeof LOCAL_COMMANDS)[number]

const DESCRIPTION: Record<LocalCommand, MessageKey> = {
  compact: 'agent.slash.compact',
  new: 'agent.slash.new',
  export: 'agent.slash.export',
  clear: 'agent.slash.clear',
}

const isLocalCommand = (word: string): word is LocalCommand => (LOCAL_COMMANDS as readonly string[]).includes(word)

/** `/compact 保留报价` → { command: 'compact', args: '保留报价' }; undefined for anything else. */
export function parseLocalCommand(text: string): { command: LocalCommand; args: string } | undefined {
  const slash = parseSlashCommand(text)
  return slash && isLocalCommand(slash.command) ? { command: slash.command, args: slash.args } : undefined
}

/** A `/` menu entry that is one of the local commands (shown with a 指令 tag instead of a skill source). */
export const isLocalCommandItem = (item: SkillSummary): boolean =>
  isLocalCommand(item.name) && item.command === `/${item.name}`

/** The `/` menu: local commands first, then the skills (one named like a local command is shadowed by it). */
export function slashMenuItems(skills: readonly SkillSummary[], tr: Translator): SkillSummary[] {
  const local: SkillSummary[] = LOCAL_COMMANDS.map((command) => ({
    name: command,
    description: tr(DESCRIPTION[command]),
    command: `/${command}`,
    source: 'builtin',
  }))
  return [...local, ...skills.filter((s) => !isLocalCommand(s.name) && !isLocalCommand(s.command.replace(/^\//, '')))]
}

export type LocalCommandSurface = Pick<AgentSurface, 'active' | 'localIds' | 'draftKey' | 'store' | 'setDialog'>

/**
 * Run the draft as a local command when it is one. Returns false (nothing done) for ordinary text and skills, which
 * the caller then sends as a turn.
 */
export function runLocalCommand(surface: LocalCommandSurface, text: string): boolean {
  const cmd = parseLocalCommand(text)
  if (!cmd) return false
  const { store, draftKey, setDialog } = surface
  const threadId = surface.active?.threadId
  const clearDraft = () => store().setDraft(draftKey, { text: '' })
  if (cmd.command === 'new') {
    clearDraft()
    void store()
      .newThread()
      .then((id) => {
        if (cmd.args) store().setDraft(id, { text: cmd.args })
      })
      // createThread already toasts the failure; the command itself has nothing left to do
      .catch(() => undefined)
    return true
  }
  // Compact / export / clear act on a thread with history; a fresh draft has none.
  if (!threadId || surface.localIds.includes(threadId)) {
    toast.info(t('agent.slash.nothingYet'))
    return true
  }
  clearDraft()
  switch (cmd.command) {
    case 'compact':
      setDialog({ kind: 'compact', threadId, ...(cmd.args ? { instructions: cmd.args } : {}) })
      return true
    case 'export':
      setDialog({ kind: 'export', threadId })
      return true
    case 'clear':
      setDialog({ kind: 'clear', threadId })
      return true
  }
}
