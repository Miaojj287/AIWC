/**
 * Where a rewind (编辑 / 重新生成 a turn) cuts the transcript, and what it discards. Pure — tested in rewind.test.ts.
 * A rewind drops the turn's prompt and everything after it; the kernel does the same to its history
 * (thread.rollback with `fromItemId`), so the edited / regenerated turn runs without the rejected answer in context.
 */
import type { ContentPart, Mention, TurnId, UserInput } from '@aiwc/protocol'
import type { ThreadItem } from './model'

type UserItem = Extract<ThreadItem, { kind: 'user' }>

export interface RewindPoint {
  /** Index of the prompt in the view's items: the view keeps `items.slice(0, index)`. */
  index: number
  /** User messages dropped (the prompt itself included) — the `turns` of thread.rollback. */
  turns: number
  /** Whole turns after the rewound one that are discarded with it (0 = the last turn). */
  laterTurns: number
}

export function rewindPoint(items: readonly ThreadItem[], fromItemId: string): RewindPoint | undefined {
  const index = items.findIndex((it) => it.kind === 'user' && it.id === fromItemId)
  if (index < 0) return undefined
  const prompt = items[index] as UserItem
  let turns = 0
  const later = new Set<TurnId>()
  for (const it of items.slice(index)) {
    if (it.kind !== 'user') continue
    turns++
    if (it.turnId !== prompt.turnId) later.add(it.turnId)
  }
  return { index, turns, laterTurns: later.size }
}

/** The prompt that opened a turn (its first user message): what 重新生成 runs again. Without a turn: the last prompt. */
export function turnPrompt(items: readonly ThreadItem[], turnId: TurnId | undefined): UserItem | undefined {
  const isUser = (it: ThreadItem): it is UserItem => it.kind === 'user'
  if (!turnId) return [...items].reverse().find(isUser)
  return items.find((it): it is UserItem => isUser(it) && it.turnId === turnId)
}

/** The prompt rerun as recorded: same text, attachments and @ chips. */
export const inputOf = (item: UserItem): UserInput => ({ content: [...item.content], mentions: [...item.mentions] })

/**
 * An edited prompt: the new text in place of the old text parts, attachments (images / files) kept, the chips as
 * edited. Undefined when nothing would be sent.
 */
export function editedInput(item: UserItem, text: string, mentions: Mention[]): UserInput | undefined {
  const trimmed = text.trim()
  const attachments: ContentPart[] = item.content.filter((p) => p.type !== 'text')
  if (!trimmed && attachments.length === 0 && mentions.length === 0) return undefined
  const content: ContentPart[] = [...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []), ...attachments]
  // The kernel requires at least one part; a chips-only prompt carries an empty text like the composer's.
  return { content: content.length ? content : [{ type: 'text', text: '' }], mentions: [...mentions] }
}
