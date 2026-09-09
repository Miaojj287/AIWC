/**
 * Composer text helpers: detecting an `@` / `/` trigger at the caret, replacing it once the user
 * picks something, and turning the draft into a kernel UserInput. Pure — tested in mentions.test.ts.
 */
import type { Mention, UserInput } from '@aiwc/protocol'

export type TriggerKind = 'mention' | 'skill'

export interface Trigger {
  kind: TriggerKind
  /** index of the trigger character */
  start: number
  /** caret position (exclusive end of the query) */
  end: number
  /** text typed after the trigger character */
  query: string
}

const TRIGGER_CHAR: Record<string, TriggerKind> = { '@': 'mention', '/': 'skill' }

/** Whitespace or line start before the trigger; the query must not contain whitespace or another trigger. */
export function detectTrigger(text: string, caret: number): Trigger | undefined {
  const pos = Math.max(0, Math.min(caret, text.length))
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i] as string
    if (/\s/.test(ch)) return undefined
    const kind = TRIGGER_CHAR[ch]
    if (kind) {
      if (i > 0 && !/\s/.test(text[i - 1] as string)) return undefined
      // a slash command only makes sense at the very start of the message
      if (kind === 'skill' && text.slice(0, i).trim().length > 0) return undefined
      return { kind, start: i, end: pos, query: text.slice(i + 1, pos) }
    }
  }
  return undefined
}

/** Replace the trigger span with `replacement` and return the new caret (after the replacement). */
export function applyTrigger(text: string, trigger: Trigger, replacement: string): { text: string; caret: number } {
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  const next = before + replacement + after
  return { text: next, caret: before.length + replacement.length }
}

export const mentionKey = (m: Pick<Mention, 'kind' | 'id'>): string => `${m.kind}:${m.id}`

/** Add a mention unless the same kind+id is already referenced. */
export function addMention(list: Mention[], m: Mention): Mention[] {
  return list.some((x) => mentionKey(x) === mentionKey(m)) ? list : [...list, m]
}

export function removeMention(list: Mention[], m: Pick<Mention, 'kind' | 'id'>): Mention[] {
  return list.filter((x) => mentionKey(x) !== mentionKey(m))
}

/** Case-insensitive substring match on label / id used by the mention popover. */
export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => f?.toLowerCase().includes(q))
}

/** Draft → kernel input. Empty drafts (no text, no mentions) return undefined. */
export function buildUserInput(text: string, mentions: Mention[]): UserInput | undefined {
  const trimmed = text.trim()
  if (!trimmed && mentions.length === 0) return undefined
  return { content: [{ type: 'text', text: trimmed }], mentions: [...mentions] }
}

export const MENTION_KIND_LABEL: Record<Mention['kind'], string> = {
  session: '会话',
  file: '文件',
  contact: '联系人',
  memory: '记忆',
}
