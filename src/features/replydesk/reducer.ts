/**
 * Reply desk state (DESIGN-SPEC §3 / ARCHITECTURE §7): drafts waiting for a decision, live
 * countdowns for `auto` drafts and the halt latch of the UI-injection channel. Pure reducer.
 */
import type { ReplyDraft } from '@aiwc/protocol'

export interface ReplyDeskState {
  generating?: Record<string, string>
  loaded: boolean
  /** Pending (and failed) drafts, oldest first. */
  drafts: ReplyDraft[]
  /** draftId → remaining ms from the last gateway countdown event. */
  countdowns: Record<string, number>
  /** Halt reason when auto-send is fused, otherwise null. */
  halted: string | null
  error?: string
}

export type ReplyDeskAction =
  | { type: 'loaded'; drafts: ReplyDraft[] }
  | { type: 'load_failed'; error: string }
  | { type: 'draft'; draft: ReplyDraft }
  | { type: 'countdown'; draftId: string; remainingMs: number }
  | { type: 'halted'; reason: string }
  | { type: 'generating'; sessionId: string; name: string; active: boolean }
  | { type: 'resumed' }
  | { type: 'dismiss'; draftId: string }

export const initialReplyDeskState: ReplyDeskState = { loaded: false, drafts: [], countdowns: {}, halted: null }

/** Drafts the desk keeps showing: pending ones, and failed ones until dismissed. */
export const isVisibleDraft = (d: ReplyDraft): boolean => d.state === 'pending' || d.state === 'failed'

const byCreated = (a: ReplyDraft, b: ReplyDraft) => a.createdAt - b.createdAt

export function replyDeskReducer(state: ReplyDeskState, action: ReplyDeskAction): ReplyDeskState {
  switch (action.type) {
    case 'loaded': {
      const fresh = action.drafts.filter(isVisibleDraft)
      // keep failed drafts we already know about (the backend only lists pending ones)
      const keptFailed = state.drafts.filter((d) => d.state === 'failed' && !fresh.some((f) => f.id === d.id))
      return { ...state, loaded: true, error: undefined, drafts: [...fresh, ...keptFailed].sort(byCreated) }
    }
    case 'load_failed':
      return { ...state, loaded: true, error: action.error }
    case 'draft': {
      const { draft } = action
      const rest = state.drafts.filter((d) => d.id !== draft.id)
      const countdowns = { ...state.countdowns }
      if (!isVisibleDraft(draft)) {
        delete countdowns[draft.id]
        return { ...state, drafts: rest, countdowns }
      }
      if (draft.state === 'failed') delete countdowns[draft.id]
      return { ...state, drafts: [...rest, draft].sort(byCreated), countdowns }
    }
    case 'countdown': {
      if (!state.drafts.some((d) => d.id === action.draftId)) return state
      return { ...state, countdowns: { ...state.countdowns, [action.draftId]: Math.max(0, action.remainingMs) } }
    }
    case 'halted':
      return { ...state, halted: action.reason }
    case 'generating': {
      const generating = { ...state.generating }
      if (action.active) generating[action.sessionId] = action.name
      else delete generating[action.sessionId]
      return { ...state, generating }
    }
    case 'resumed':
      return { ...state, halted: null }
    case 'dismiss': {
      const countdowns = { ...state.countdowns }
      delete countdowns[action.draftId]
      return { ...state, drafts: state.drafts.filter((d) => d.id !== action.draftId), countdowns }
    }
    default:
      return state
  }
}

/** Number the shell may show as a badge: drafts that still need a decision. */
export function pendingCount(state: ReplyDeskState): number {
  return state.drafts.filter((d) => d.state === 'pending').length
}

/** Remaining ms for an auto draft — prefers the live gateway countdown, falls back to countdownEndsAt. */
export function remainingMs(state: ReplyDeskState, draft: ReplyDraft, now: number): number | undefined {
  if (draft.mode !== 'auto') return undefined
  const live = state.countdowns[draft.id]
  if (live !== undefined) return live
  if (draft.countdownEndsAt !== undefined) return Math.max(0, draft.countdownEndsAt - now)
  return undefined
}

export const MODE_LABEL: Record<ReplyDraft['mode'], string> = { suggest: '建议', confirm: '待确认', auto: '自动发送' }
