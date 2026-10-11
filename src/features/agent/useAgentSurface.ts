/**
 * The Agent surface controller shared by the panel (AgentPanel) and the Agent window (window/AgentWindow):
 * the store subscription, hydration, the model list, the "always one open thread" rule, thread actions and
 * their dialogs. Both surfaces render exactly this state — that is what keeps them feature-for-feature equal
 * (CLAUDE.md §12). Add a capability here (or in ThreadConversation), never in one surface only.
 */
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { SkillSummary, ThreadId, ThreadSettings, ThreadSummary, UserInput } from '@aiwc/protocol'
import { detectMac } from '@/app/shortcuts'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { onSkillsChanged } from '@/platform/skills'
import { isRewindBusy } from './agentConversationOps'
import { subscribeAgentEvents, useAgentStore, type ModelOption } from './agentStore'
import { installDraftPersistence } from './draftPersistence'
import { emptyDraft, SCRATCH_DRAFT_KEY, type ComposerDraft, type ThreadViewState } from './model'
import { rewindPoint } from './rewind'
import { prefillSaveAsSkill } from './saveAsSkill'
import { useAttentionSync } from './threadAttention'
import type { ThreadDialog } from './ThreadDialogs'
import type { ThreadAction } from './threadMenus'

export interface AgentSurface {
  /** Every desktop thread not archived, pinned first then most recent (unsent local drafts included). */
  threads: ThreadSummary[]
  /** The 已归档 list (loaded on demand: `store().loadArchived()`). */
  archived: ThreadSummary[]
  archivedLoaded: boolean
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
  /**
   * 编辑 / 重新生成 a turn: rewind to its prompt and run `input`. Asks first when later turns would be discarded too
   * (the `rewind` dialog); the last turn is rewound at once.
   */
  rewind: (threadId: ThreadId, fromItemId: string, input: UserInput) => void
  store: typeof useAgentStore.getState
}

export interface AgentSurfaceOptions {
  /** The panel is collapsed: no thread is auto-created and new output raises the unread dot. */
  collapsed: boolean
}

export function useAgentSurface({ collapsed }: AgentSurfaceOptions): AgentSurface {
  const allThreads = useAgentStore((s) => s.threads)
  const archived = useAgentStore((s) => s.archived)
  const archivedLoaded = useAgentStore((s) => s.archivedLoaded)
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
  // An archived thread opened from 已归档 still shows as a tab, but not in the history lists.
  const threads = useMemo(() => allThreads.filter((t) => !t.archived), [allThreads])
  const open = useMemo(
    () =>
      openIds
        .map((id) => allThreads.find((t) => t.threadId === id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
    [openIds, allThreads],
  )
  const saved = useMemo(() => threads.filter((t) => !localIds.includes(t.threadId)), [threads, localIds])
  const active = activeThreadId ? allThreads.find((t) => t.threadId === activeThreadId) : undefined

  useEffect(() => {
    subscribeAgentEvents()
    installDraftPersistence()
    void store().hydrate()
  }, [store])
  // 设置 › 技能 switched a skill off / on, or the Agent created one: the `/` menu follows.
  useEffect(() => onSkillsChanged(() => void store().loadSkills()), [store])
  useEffect(() => {
    store().setCollapsed(collapsed)
  }, [collapsed, store])
  // 已完成未查看 / 失败 marks: cleared for the thread on screen; their count is the dock badge.
  useAttentionSync(activeThreadId, collapsed, allThreads)
  useEffect(() => {
    if (!collapsed && hydrated && !loadError && !store().openIds.length) void store().ensureActiveThread()
  }, [collapsed, hydrated, loadError, openIds.length, store])
  // Keep the toolbar's model list in step with 设置 › AI 接入 (providers added / models enabled or disabled).
  const aiConfig = useConfig((c) => c.ai)
  useEffect(() => {
    if (aiConfig) void store().loadModels()
  }, [aiConfig, store])

  const onAction = useCallback(
    (action: ThreadAction, id: ThreadId) => {
      const thread = store().threads.find((x) => x.threadId === id)
      switch (action) {
        case 'rename':
          setDialog({ kind: 'rename', threadId: id, title: thread?.title ?? '' })
          return
        case 'export':
          setDialog({ kind: 'export', threadId: id })
          return
        case 'saveSkill':
          prefillSaveAsSkill(store, id)
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
        case 'archive':
        case 'unarchive':
          void store().archive(id, action === 'archive')
          return
      }
    },
    [store],
  )

  const rewind = useCallback(
    (threadId: ThreadId, fromItemId: string, input: UserInput) => {
      const view = store().views[threadId]
      const point = view ? rewindPoint(view.items, fromItemId) : undefined
      if (!point) return
      if (isRewindBusy(view)) {
        toast.info(t('agent.stream.rewind.busy'))
        return
      }
      if (point.laterTurns > 0) setDialog({ kind: 'rewind', threadId, fromItemId, input, laterTurns: point.laterTurns })
      else void store().rewindTurn(threadId, fromItemId, input)
    },
    [store],
  )

  return {
    threads,
    archived,
    archivedLoaded,
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
    rewind,
    store,
  }
}
