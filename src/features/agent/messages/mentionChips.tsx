/**
 * Mention chips shared by the user message and the composer: icon per kind, click opens the
 * referenced object in the workspace (session → chat tab, file → file tab, contact → clone tab,
 * memory → settings › 记忆).
 */
import { AtSign, Brain, FileText, User } from 'lucide-react'
import type { Mention } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { Chip, type IconComponent } from '@/kit'

export const MENTION_ICON: Record<Mention['kind'], IconComponent> = {
  session: AtSign,
  file: FileText,
  contact: User,
  memory: Brain,
}

export function openMention(m: Mention): void {
  switch (m.kind) {
    case 'session':
      runCommand('tab.openChat', { sessionId: m.id, title: m.label })
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
          key={`${m.kind}:${m.id}`}
          variant="mention"
          icon={MENTION_ICON[m.kind]}
          label={m.label}
          title={m.label}
          onRemove={onRemove ? () => onRemove(m) : undefined}
          onClick={onRemove ? undefined : () => openMention(m)}
          className="h-5 max-w-[180px] text-micro"
        />
      ))}
    </div>
  )
}
