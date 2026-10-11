/**
 * Mention chips shared by the user message and the composer: icon per kind, click opens the
 * referenced object in the workspace (session → chat tab, file → file tab, contact → clone tab,
 * memory → settings › 记忆).
 */
import { AtSign, Brain, FileText, User } from 'lucide-react'
import type { Mention } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { t } from '@/i18n'
import { Chip, type IconComponent } from '@/kit'
import { mentionKey } from '../mentions'

export const MENTION_ICON: Record<Mention['kind'], IconComponent> = {
  session: AtSign,
  file: FileText,
  contact: User,
  memory: Brain,
}

export function openMention(m: Mention): void {
  switch (m.kind) {
    case 'session':
      runCommand('tab.openChat', { sessionId: m.id, title: m.label, focusMessageId: m.messageIds?.[0] })
      return
    case 'file':
      runCommand('tab.openFile', { path: m.id, title: m.label })
      return
    case 'contact':
      runCommand('tab.openClone', { contactId: m.id, title: m.label })
      return
    case 'memory':
      runCommand('tab.openSettings', { page: 'memory', highlight: m.id })
      return
  }
}

/** A quote shows how many messages it carries: 「产品群 · 3 条」. */
export const mentionLabel = (m: Mention): string =>
  m.messageIds?.length ? t('agent.thread.quotedMessages', { label: m.label, n: m.messageIds.length }) : m.label

export interface MentionChipsProps {
  mentions: Mention[]
  /** Removable chips (composer). Omit for read-only chips that open the referenced object. */
  onRemove?: (m: Mention) => void
  className?: string
}

export function MentionChips({ mentions, onRemove, className }: MentionChipsProps) {
  if (mentions.length === 0) return null
  return (
    <div className={className}>
      {mentions.map((m) => (
        <Chip
          key={mentionKey(m)}
          variant="mention"
          icon={MENTION_ICON[m.kind]}
          label={mentionLabel(m)}
          title={mentionLabel(m)}
          onRemove={onRemove ? () => onRemove(m) : undefined}
          onClick={onRemove ? undefined : () => openMention(m)}
          className="h-5 max-w-[180px] text-micro"
        />
      ))}
    </div>
  )
}
