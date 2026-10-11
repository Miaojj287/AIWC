/**
 * Composer text helpers: detecting an `@` / `/` trigger at the caret, replacing it once the user
 * picks something, and turning the draft into a kernel UserInput. Pure — tested in mentions.test.ts.
 */
import {
  MAX_QUOTED_MESSAGES,
  type ContentPart,
  type DraftAttachment,
  type Mention,
  type UserInput,
} from '@aiwc/protocol'

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

// The full-width forms are what a Chinese input method types in full-width mode.
const TRIGGER_CHAR: Record<string, TriggerKind> = { '@': 'mention', '＠': 'mention', '/': 'skill', '／': 'skill' }

/**
 * What may sit right before an `@` that starts a mention: Chinese text is written without spaces, so besides
 * whitespace a Han character, CJK punctuation or a full-width form also counts ("总结@产品群"). A Latin letter or
 * digit does not, so `foo@bar` stays text.
 */
const MENTION_BOUNDARY = /[\s\p{Script=Han}　-〿＀-￯—‘’“”…·]/u
/** After a Han character, a query shaped like a domain is an e-mail address being typed ("邮箱@example.com"). */
const DOMAIN_LIKE = /^[\w-]+(\.[\w-]+)+/

/**
 * Trigger at the caret: `@` after whitespace, line start or Chinese text; `/` only at the start of the message. The
 * query must not contain whitespace or another trigger.
 */
export function detectTrigger(text: string, caret: number): Trigger | undefined {
  const pos = Math.max(0, Math.min(caret, text.length))
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i] as string
    if (/\s/.test(ch)) return undefined
    const kind = TRIGGER_CHAR[ch]
    if (kind) {
      const query = text.slice(i + 1, pos)
      // a slash command only makes sense at the very start of the message
      if (kind === 'skill') return text.slice(0, i).trim() ? undefined : { kind, start: i, end: pos, query }
      const before = i > 0 ? (text[i - 1] as string) : undefined
      if (before !== undefined && !MENTION_BOUNDARY.test(before)) return undefined
      if (before !== undefined && !/\s/.test(before) && DOMAIN_LIKE.test(query)) return undefined
      return { kind, start: i, end: pos, query }
    }
  }
  return undefined
}

/**
 * A Chinese input method types 、 (or ／) for the `/` key. When that is the first thing typed in the message, it is
 * meant as the skill trigger: return the text with it turned into `/` and the caret after it. `previous` is the
 * value before this edit, `caret` the caret after it; anything other than a single such keystroke returns undefined.
 */
export function normalizeSlashKey(
  previous: string,
  next: string,
  caret: number,
): { text: string; caret: number } | undefined {
  if (next.length !== previous.length + 1 || caret < 1) return undefined
  const typed = next[caret - 1]
  if (typed !== '、' && typed !== '／') return undefined
  const before = next.slice(0, caret - 1)
  if (before.trim() || before + next.slice(caret) !== previous) return undefined
  return { text: `${before}/${next.slice(caret)}`, caret }
}

/** Replace the trigger span with `replacement` and return the new caret (after the replacement). */
export function applyTrigger(text: string, trigger: Trigger, replacement: string): { text: string; caret: number } {
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  const next = before + replacement + after
  return { text: next, caret: before.length + replacement.length }
}

/** Type `@` at the caret for the + button: a space first when the caret follows a word, so the trigger is detected. */
export function insertMentionTrigger(text: string, caret: number): { text: string; caret: number } {
  const pos = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, pos)
  const insert = before && !/\s$/.test(before) ? ' @' : '@'
  return { text: before + insert + text.slice(pos), caret: pos + insert.length }
}

/**
 * Step through earlier prompts with ↑ / ↓ (oldest first in `history`). `index` is the entry being shown, or undefined
 * while not browsing; stepping down past the newest entry leaves browsing with an empty draft.
 */
export function stepPromptHistory(
  history: readonly string[],
  index: number | undefined,
  direction: 'older' | 'newer',
): { index: number | undefined; text: string } | undefined {
  if (history.length === 0) return undefined
  if (direction === 'older') {
    const next = index === undefined ? history.length - 1 : Math.max(0, index - 1)
    return { index: next, text: history[next] ?? '' }
  }
  if (index === undefined) return undefined
  const next = index + 1
  return next >= history.length ? { index: undefined, text: '' } : { index: next, text: history[next] ?? '' }
}

/** A quote of picked messages and a reference to the whole chat are different chips, even for the same chat. */
export const mentionKey = (m: Pick<Mention, 'kind' | 'id' | 'messageIds'>): string =>
  `${m.kind}:${m.id}${m.messageIds?.length ? ':quote' : ''}`

/**
 * Add a mention unless the same one is already referenced. Quoting more messages of a chat that is already quoted
 * merges them into that chip (bounded by MAX_QUOTED_MESSAGES).
 */
export function addMention(list: Mention[], m: Mention): Mention[] {
  const key = mentionKey(m)
  const existing = list.find((x) => mentionKey(x) === key)
  if (!existing) return [...list, m]
  if (!m.messageIds?.length) return list
  const messageIds = [...new Set([...(existing.messageIds ?? []), ...m.messageIds])].slice(0, MAX_QUOTED_MESSAGES)
  return list.map((x) => (x === existing ? { ...x, messageIds } : x))
}

export function removeMention(list: Mention[], m: Pick<Mention, 'kind' | 'id' | 'messageIds'>): Mention[] {
  return list.filter((x) => mentionKey(x) !== mentionKey(m))
}

/** Case-insensitive substring match on label / id used by the mention popover. */
export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => f?.toLowerCase().includes(q))
}

/**
 * Draft → kernel input: the text first, then the attachments. Empty drafts (no text, mentions or attachments) return
 * undefined. A draft of attachments only carries no text part.
 */
export function buildUserInput(
  text: string,
  mentions: Mention[],
  attachments: readonly DraftAttachment[] = [],
): UserInput | undefined {
  const trimmed = text.trim()
  if (!trimmed && mentions.length === 0 && attachments.length === 0) return undefined
  const textPart: ContentPart[] = trimmed || attachments.length === 0 ? [{ type: 'text', text: trimmed }] : []
  return { content: [...textPart, ...attachments.map((a) => a.part)], mentions: [...mentions] }
}
