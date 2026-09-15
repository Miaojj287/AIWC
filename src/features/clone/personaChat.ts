/**
 * Persona test-chat state (DESIGN-SPEC §4 已克隆 · 左栏): a reducer over kernel events for one thread,
 * plus conversion of stored HistoryItems. Pure — tested in personaChat.test.ts.
 */
import type { ContentPart, Event, HistoryItem, ThreadId } from '@aiwc/protocol'
import { splitPersonaBubbles } from '@aiwc/protocol'
import { t, type MessageKey } from '@/i18n'

export interface PersonaMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  /** Sent locally, not yet echoed back by the kernel (item.user). */
  pending?: boolean
  streaming?: boolean
}

export interface PersonaChatState {
  threadId: ThreadId | null
  messages: PersonaMessage[]
  generating: boolean
  error?: string
}

export type PersonaChatAction =
  | { type: 'thread'; threadId: ThreadId | null; messages?: PersonaMessage[] }
  | { type: 'send'; localId: string; text: string; at: number }
  | { type: 'event'; event: Event; now: number }
  | { type: 'clear' }
  /** A send that never reached the kernel; `localId` is its optimistic bubble, which is dropped. */
  | { type: 'error'; message: string; localId?: string }

export const initialPersonaChat: PersonaChatState = { threadId: null, messages: [], generating: false }

export function contentText(content: readonly ContentPart[]): string {
  return content
    .map((p) => (p.type === 'text' ? p.text : p.type === 'image' ? t('clone.chat.image') : `[${p.name}]`))
    .join('\n')
    .trim()
}

/** Transcript from agent:getThread items (internal items are skipped). */
export function messagesFromHistory(items: readonly HistoryItem[]): PersonaMessage[] {
  const out: PersonaMessage[] = []
  for (const it of items) {
    if (it.type === 'user_message')
      out.push({ id: it.id, role: 'user', text: contentText(it.content), at: it.createdAt })
    else if (it.type === 'assistant_message')
      out.push({ id: it.id, role: 'assistant', text: it.text, at: it.createdAt })
  }
  return out
}

export function personaChatReducer(state: PersonaChatState, action: PersonaChatAction): PersonaChatState {
  switch (action.type) {
    case 'thread':
      return { threadId: action.threadId, messages: action.messages ?? [], generating: false }
    case 'send':
      return {
        ...state,
        error: undefined,
        generating: true,
        messages: [
          ...state.messages,
          { id: action.localId, role: 'user', text: action.text, at: action.at, pending: true },
        ],
      }
    case 'clear':
      return { ...state, messages: [], generating: false, error: undefined }
    case 'error':
      return {
        ...state,
        generating: false,
        error: action.message,
        messages: action.localId ? dropUnconfirmed(state.messages, action.localId) : state.messages,
      }
    case 'event':
      return applyEvent(state, action.event, action.now)
    default:
      return state
  }
}

function applyEvent(state: PersonaChatState, e: Event, now: number): PersonaChatState {
  if (!state.threadId || e.threadId !== state.threadId) return state
  switch (e.type) {
    case 'item.user': {
      const text = contentText(e.content)
      const idx = state.messages.findIndex((m) => m.role === 'user' && m.pending && m.text === text)
      if (idx >= 0)
        return {
          ...state,
          messages: state.messages.map((m, i) => (i === idx ? { ...m, id: e.itemId, pending: false } : m)),
        }
      if (state.messages.some((m) => m.id === e.itemId)) return state
      return { ...state, messages: [...state.messages, { id: e.itemId, role: 'user', text, at: now }] }
    }
    case 'turn.started':
      return { ...state, generating: true, error: undefined }
    case 'text.start':
      if (state.messages.some((m) => m.id === e.itemId)) return state
      return {
        ...state,
        generating: true,
        messages: [...state.messages, { id: e.itemId, role: 'assistant', text: '', at: now, streaming: true }],
      }
    case 'text.delta':
      return {
        ...state,
        messages: upsertAssistant(state.messages, e.itemId, (m) => ({ ...m, text: m.text + e.delta }), now),
      }
    case 'text.end':
      return {
        ...state,
        messages: upsertAssistant(state.messages, e.itemId, (m) => ({ ...m, text: e.text, streaming: false }), now),
      }
    case 'turn.completed':
      return {
        ...state,
        generating: false,
        messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      }
    case 'turn.aborted':
      return {
        ...state,
        generating: false,
        messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      }
    case 'error':
      return { ...state, generating: false, error: e.error.message, messages: dropUnconfirmed(state.messages) }
    default:
      return state
  }
}

/**
 * Optimistic user bubbles the kernel never echoed (item.user) are not in the thread: a turn that fails
 * before recording its input (no model, blocked hook) reports `error` and must not leave them pending
 * forever — 重试 sends the text again. Should the kernel record the message after all, item.user
 * appends it back. (`turn.aborted` follows that error later and is left alone, so it cannot drop the
 * bubble of a retry sent in between.)
 */
function dropUnconfirmed(messages: PersonaMessage[], localId?: string): PersonaMessage[] {
  return messages.filter((m) => !(m.role === 'user' && m.pending && (localId === undefined || m.id === localId)))
}

function upsertAssistant(
  list: PersonaMessage[],
  id: string,
  fn: (m: PersonaMessage) => PersonaMessage,
  now: number,
): PersonaMessage[] {
  const idx = list.findIndex((m) => m.id === id)
  if (idx < 0) return [...list, fn({ id, role: 'assistant', text: '', at: now, streaming: true })]
  return list.map((m, i) => (i === idx ? fn(m) : m))
}

/**
 * A clone answers the way the person texts: several short messages, not one paragraph. The model
 * emits them in one reply separated by PERSONA_BURST_MARKER; the view renders one bubble per part.
 * Splitting mid-stream is safe — a partial reply just has fewer parts.
 */
export function bubblesOf(m: Pick<PersonaMessage, 'text' | 'streaming'>): string[] {
  const parts = splitPersonaBubbles(m.text, m.streaming === true)
  return parts.length > 0 ? parts : ['']
}

export type Verdict = 'up' | 'down' | 'not_like'

/** Catalog keys — resolve with t() at render. */
export const VERDICT_LABEL: Record<Verdict, MessageKey> = {
  up: 'clone.verdict.up',
  down: 'clone.verdict.down',
  not_like: 'clone.verdict.notLike',
}
