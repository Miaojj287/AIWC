/**
 * 已完成未查看 / 失败 marks on Agent threads, and the dock badge that counts them. A desktop thread whose turn ends
 * while the user is not looking at it — another thread is active, the panel is collapsed, or the window is in the
 * background — gets `unread` (a reply is waiting) or `failed` (the turn ended in an error, a timeout, the step cap or
 * the loop guard). Looking at the thread clears it. Marks are a per-viewer convenience kept in localStorage; the badge
 * count goes to the main process (automation:setBadge), which shows it on the macOS dock.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ChannelKind, Event, ThreadId } from '@aiwc/protocol'
import type { Translator } from '@/i18n'
import { invoke } from '@/platform/hooks'

export type AttentionMark = 'unread' | 'failed'

const STORAGE_KEY = 'aiwc.agent.attention'
const FAILED_REASONS: ReadonlySet<string> = new Set(['error', 'timeout', 'step_cap', 'loop_guard'])

interface AttentionState {
  marks: Record<string, AttentionMark>
  /** The thread on screen right now, or null when none is (panel collapsed, window in the background). */
  viewing: ThreadId | null
  setViewing(threadId: ThreadId | null): void
  clear(threadId: ThreadId): void
}

function readMarks(): Record<string, AttentionMark> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object') return {}
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (entry): entry is [string, AttentionMark] => entry[1] === 'unread' || entry[1] === 'failed',
      ),
    )
  } catch {
    return {}
  }
}

function writeMarks(marks: Record<string, AttentionMark>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks))
  } catch {
    // storage blocked (private window): the marks just do not survive a reload
  }
}

export const useThreadAttention = create<AttentionState>((set, get) => ({
  marks: readMarks(),
  viewing: null,
  setViewing(threadId) {
    if (get().viewing === threadId) return
    set({ viewing: threadId })
    if (threadId) get().clear(threadId)
  },
  clear(threadId) {
    if (!get().marks[threadId]) return
    const { [threadId]: _gone, ...rest } = get().marks
    set({ marks: rest })
    writeMarks(rest)
  },
}))

/** The kit Tab status dot for a mark (panel tab strip). */
export function attentionIndicator(
  mark: AttentionMark | undefined,
  t: Translator,
): { tone: 'accent' | 'danger'; label: string } | undefined {
  if (mark === 'failed') return { tone: 'danger', label: t('agent.attention.failed') }
  if (mark === 'unread') return { tone: 'accent', label: t('agent.attention.unread') }
  return undefined
}

/** What a kernel event does to a thread's mark; undefined = nothing. Pure (tested). */
export function attentionFor(e: Event): AttentionMark | undefined {
  if (e.type === 'turn.completed') return 'unread'
  if (e.type === 'turn.aborted' && FAILED_REASONS.has(e.reason)) return 'failed'
  return undefined
}

/** Called for every kernel event (agentEvents.ts): marks a desktop thread whose turn ended out of sight. */
export function noteThreadAttention(e: Event, channel: ChannelKind | undefined): void {
  if (channel !== 'desktop') return
  const mark = attentionFor(e)
  if (!mark) return
  const state = useThreadAttention.getState()
  if (state.viewing === e.threadId) return
  // a failure is not downgraded to unread by a later success the user has not seen either
  const next = state.marks[e.threadId] === 'failed' && mark === 'unread' ? 'failed' : mark
  const marks = { ...state.marks, [e.threadId]: next }
  useThreadAttention.setState({ marks })
  writeMarks(marks)
}

/** Marked threads that still exist (a deleted thread's mark never inflates the badge). */
export const attentionCount = (
  marks: Record<string, AttentionMark>,
  threads: readonly { threadId: ThreadId }[],
): number => threads.filter((thread) => marks[thread.threadId]).length

/**
 * Keeps `viewing` in step with what is on screen (shared by the panel and the Agent window through
 * useAgentSurface), and the dock badge in step with the marks.
 */
export function useAttentionSync(
  activeThreadId: ThreadId | null,
  collapsed: boolean,
  threads: readonly { threadId: ThreadId }[],
): void {
  useEffect(() => {
    const update = (): void => {
      const visible = !collapsed && document.visibilityState !== 'hidden' && document.hasFocus()
      useThreadAttention.getState().setViewing(visible ? activeThreadId : null)
    }
    update()
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [activeThreadId, collapsed])

  const marks = useThreadAttention((s) => s.marks)
  const count = attentionCount(marks, threads)
  useEffect(() => {
    // best effort: a host without a dock (web preview) simply shows no badge
    void invoke('automation:setBadge', { count }).catch(() => undefined)
  }, [count])
}
