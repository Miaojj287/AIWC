/**
 * The Agent surface controller shared by the panel (AgentPanel) and the Agent window (window/AgentWindow):
 * the store subscription, hydration, the model list, the "always one open thread" rule, thread actions and
 * their dialogs. Both surfaces render exactly this state — that is what keeps them feature-for-feature equal
 * (CLAUDE.md §12). Add a capability here (or in ThreadConversation), never in one surface only.
 */
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { Mention, SkillSummary, ThreadId, ThreadSettings, ThreadSummary } from '@aiwc/protocol'
import { detectMac } from '@/app/shortcuts'
import { useConfig } from '@/platform/configStore'
import { subscribeAgentEvents, useAgentStore, type ModelOption } from './agentStore'
import { emptyDraft, SCRATCH_DRAFT_KEY, type ComposerDraft, type ThreadViewState } from './model'
import type { ThreadDialog } from './ThreadDialogs'
import type { ThreadAction } from './threadMenus'

export interface AgentSurface {
  /** Every desktop thread, pinned first then most recent (unsent local drafts included). */
  threads: ThreadSummary[]
  /** Threads with kernel history — the history list; local drafts are left out. */
  saved: ThreadSummary[]
  /** Threads shown as tabs in the panel strip, in strip order. */
  open: ThreadSummary[]
  openIds: ThreadId[]
  localIds: ThreadId[]
  active: ThreadSummary | undefined
  activeThreadId: ThreadId | null
  view: ThreadViewState | undefined
  views: Record<string, ThreadViewState>
  /** Draft slot the composer edits: the active thread, or the scratch slot while none is open. */
  draftKey: ThreadId
  draft: ComposerDraft
  focusSeq: number
  models: ModelOption[]
  skills: SkillSummary[]
  hydrated: boolean
  hydrating: boolean
  loadError: string | undefined
  streaming: boolean
  settings: ThreadSettings | undefined
  mac: boolean
  dialog: ThreadDialog | undefined
  setDialog: Dispatch<SetStateAction<ThreadDialog | undefined>>
  /** A thread action from any menu: opens the matching dialog, or exports right away. */
  onAction: (action: ThreadAction, id: ThreadId) => void
  /** Send text into the active thread, creating one when none is open (suggestion chips). */
  sendText: (text: string, mentions: Mention[]) => Promise<void>
  store: typeof useAgentStore.getState
}

export interface AgentSurfaceOptions {
  /** The panel is collapsed: no thread is auto-created and new output raises the unread dot. */
  collapsed: boolean
}

export function useAgentSurface({ collapsed }: AgentSurfaceOptions): AgentSurface {
  const threads = useAgentStore((s) => s.threads)
  const localIds = useAgentStore((s) => s.localIds)
  const hydrated = useAgentStore((s) => s.hydrated)
  const openIds = useAgentStore((s) => s.openIds)
  const activeThreadId = useAgentStore((s) => s.activeThreadId)
  const views = useAgentStore((s) => s.views)
  const view = activeThreadId ? views[activeThreadId] : undefined
  const draftKey = activeThreadId ?? SCRATCH_DRAFT_KEY
  const draft = useAgentStore((s) => s.drafts[draftKey]) ?? emptyDraft()
  const focusSeq = useAgentStore((s) => s.focusSeq)
  const models = useAgentStore((s) => s.models)
  const skills = useAgentStore((s) => s.skills)
  const hydrating = useAgentStore((s) => s.hydrating)
  const loadError = useAgentStore((s) => s.loadError)
  const mac = useMemo(() => detectMac(), [])
  const [dialog, setDialog] = useState<ThreadDialog | undefined>(undefined)

  const store = useAgentStore.getState
  const open = useMemo(
    () =>
      openIds.map((id) => threads.find((t) => t.threadId === id)).filter((t): t is NonNullable<typeof t> => Boolean(t)),
    [openIds, threads],
  )
  const saved = useMemo(() => threads.filter((t) => !localIds.includes(t.threadId)), [threads, localIds])
  const active = activeThreadId ? threads.find((t) => t.threadId === activeThreadId) : undefined

  useEffect(() => {
    subscribeAgentEvents()
    void store().hydrate()
  }, [store])
  useEffect(() => {
    store().setCollapsed(collapsed)
  }, [collapsed, store])
  useEffect(() => {
    if (!collapsed && hydrated && !loadError && !store().openIds.length) void store().ensureActiveThread()
  }, [collapsed, hydrated, loadError, openIds.length, store])
  // Keep the toolbar's model list in step with 设置 › AI 接入 (providers added / models enabled or disabled).
  const aiConfig = useConfig((c) => c.ai)
  useEffect(() => {
    if (aiConfig) void store().loadModels()
  }, [aiConfig, store])

  const sendText = useCallback(
    async (text: string, mentions: Mention[]) => {
      const id = await store().ensureActiveThread()
      await store().send(id, { text, mentions })
    },
    [store],
  )

  const onAction = useCallback(
    (action: ThreadAction, id: ThreadId) => {
      const thread = store().threads.find((x) => x.threadId === id)
      switch (action) {
        case 'rename':
          setDialog({ kind: 'rename', threadId: id, title: thread?.title ?? '' })
          return
        case 'export':
          void store().exportThread(id)
          return
        case 'compact':
          setDialog({ kind: 'compact', threadId: id })
          return
        case 'clear':
          setDialog({ kind: 'clear', threadId: id })
          return
        case 'delete':
          setDialog({ kind: 'delete', threadId: id, title: thread?.title ?? '' })
          return
      }
    },
    [store],
  )

  return {
    threads,
    saved,
    open,
    openIds,
    localIds,
    active,
    activeThreadId,
    view,
    views,
    draftKey,
    draft,
    focusSeq,
    models,
    skills,
    hydrated,
    hydrating,
    loadError,
    streaming: view?.isStreaming ?? false,
    settings: active?.settings,
    mac,
    dialog,
    setDialog,
    onAction,
    sendText,
    store,
  }
}
