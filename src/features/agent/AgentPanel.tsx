/**
 * AgentPanel — the always-present right column (CLAUDE.md §1, §5): thread tabs → message list →
 * composer. Collapsed it renders a 40px strip with the bot button and unread dot. Wires agentStore
 * to the presentational pieces; nothing here talks to the bridge directly.
 */
import { Bot } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Mention, ThreadId } from '@aiwc/protocol'
import { detectMac, shortcutLabel } from '@/app/shortcuts'
import { EmptyState, IconButton, Tooltip } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { useShellStore } from '@/shell/shellStore'
import { subscribeAgentEvents, useAgentStore } from './agentStore'
import { Composer } from './Composer'
import { ContextRing } from './composer/ContextRing'
import { ModelSelect, modelLabelFor } from './composer/ModelSelect'
import { PermissionSelect } from './composer/PermissionSelect'
import { defaultMentionSources } from './mentionSources'
import { MessageList } from './MessageList'
import { emptyDraft, SCRATCH_DRAFT_KEY } from './model'
import { ThreadDialogs, type ThreadDialog } from './ThreadDialogs'
import { ThreadTabs, type ThreadAction } from './ThreadTabs'

export interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function AgentPanel({ collapsed, onToggleCollapsed }: AgentPanelProps) {
  const threads = useAgentStore((s) => s.threads)
  const localIds = useAgentStore((s) => s.localIds)
  const hydrated = useAgentStore((s) => s.hydrated)
  const openIds = useAgentStore((s) => s.openIds)
  const activeThreadId = useAgentStore((s) => s.activeThreadId)
  const view = useAgentStore((s) => (s.activeThreadId ? s.views[s.activeThreadId] : undefined))
  const draftKey = activeThreadId ?? SCRATCH_DRAFT_KEY
  const draft = useAgentStore((s) => s.drafts[draftKey]) ?? emptyDraft()
  const focusSeq = useAgentStore((s) => s.focusSeq)
  const models = useAgentStore((s) => s.models)
  const skills = useAgentStore((s) => s.skills)
  const hydrating = useAgentStore((s) => s.hydrating)
  const loadError = useAgentStore((s) => s.loadError)
  const unread = useShellStore((s) => s.agentUnread)
  const mac = useMemo(() => detectMac(), [])
  const [dialog, setDialog] = useState<ThreadDialog | undefined>(undefined)

  const store = useAgentStore.getState
  const open = useMemo(() => openIds.map((id) => threads.find((t) => t.threadId === id)).filter((t): t is NonNullable<typeof t> => Boolean(t)), [openIds, threads])
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
  }, [collapsed, hydrated, loadError, store])
  // Keep the toolbar's model list in step with 设置 › AI 接入 (providers added / models enabled or disabled).
  const aiConfig = useConfig((c) => c.ai)
  useEffect(() => {
    if (aiConfig) void store().loadModels()
  }, [aiConfig, store])

  /* ---- composer actions --------------------------------------------------------------- */
  const sendText = useCallback(
    async (text: string, mentions: Mention[]) => {
      const id = await store().ensureActiveThread()
      await store().send(id, { text, mentions })
    },
    [store],
  )

  const onAction = useCallback(
    (action: ThreadAction, id: ThreadId) => {
      const t = store().threads.find((x) => x.threadId === id)
      switch (action) {
        case 'rename':
          setDialog({ kind: 'rename', threadId: id, title: t?.title ?? '' })
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
          setDialog({ kind: 'delete', threadId: id, title: t?.title ?? '' })
          return
      }
    },
    [store],
  )

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-l border-line-6 bg-panel pt-2" data-testid="agent-panel-strip">
        <Tooltip content={unread ? 'Agent 有新消息' : '展开 Agent 面板'} kbd={shortcutLabel('agent.toggleCollapsed', mac)} side="left">
          <span className="relative inline-flex">
            <IconButton icon={Bot} label="展开 Agent 面板" onClick={onToggleCollapsed} active={unread} />
            {unread ? <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-chip bg-accent" /> : null}
          </span>
        </Tooltip>
      </div>
    )
  }

  const settings = active?.settings
  const streaming = view?.isStreaming ?? false

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel" data-testid="agent-panel-root">
      <ThreadTabs
        open={open}
        all={threads.filter((t) => !localIds.includes(t.threadId))}
        activeId={activeThreadId}
        mac={mac}
        onSelect={(id) => store().setActive(id)}
        onClose={(id) => store().closeThread(id)}
        onCloseOthers={(id) => store().closeOtherThreads(id)}
        onNew={() => void store().newThread()}
        onPin={(id, pinned) => void store().pin(id, pinned)}
        onAction={onAction}
        onToggleCollapsed={onToggleCollapsed}
      />

      <div className="min-h-0 flex-1">
        {active && view ? (
          <MessageList
            key={active.threadId}
            items={view.items}
            streaming={streaming}
            turnStartedAt={view.turnStartedAt}
            pendingApprovals={view.pendingApprovals}
            suggestions={view.suggestions}
            loading={!view.loaded}
            loadError={view.loadError}
            onRetryLoad={() => void store().loadThread(active.threadId)}
            modelLabel={modelLabelFor(models, settings?.model)}
            onSuggestion={(text) => void sendText(text, draft.mentions)}
            onResolveApproval={(approvalId, decision) => void store().resolveApproval(active.threadId, approvalId, decision)}
            onStop={() => void store().interrupt(active.threadId)}
            onEdit={(text, mentions) => {
              store().setDraft(active.threadId, { text, mentions })
              store().requestFocus()
            }}
            onResend={(text, mentions) => void store().send(active.threadId, { text, mentions })}
            onViewSummary={(item) => {
              setDialog({ kind: 'summary', threadId: active.threadId, summary: item.summary })
              if (!item.summary) void store().loadCompactionSummary(active.threadId, item.summaryItemId ?? item.id).then((summary) => setDialog((d) => (d?.kind === 'summary' ? { ...d, summary } : d)))
            }}
            onCompact={() => setDialog({ kind: 'compact', threadId: active.threadId })}
          />
        ) : hydrating ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState variant="loading" title="正在加载会话" compact />
          </div>
        ) : loadError ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState variant="error" title="会话列表加载失败" description={loadError} compact action={{ label: '重试', onClick: () => void store().hydrate() }} />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2 px-3 pb-2.5 pt-1">
        <Composer
          key={draftKey}
          disabled={!active || !view?.loaded || Boolean(view.loadError)}
          value={draft.text}
          onValueChange={(text) => store().setDraft(draftKey, { text })}
          mentions={draft.mentions}
          onMentionsChange={(mentions) => store().setDraft(draftKey, { mentions })}
          onSubmit={() => void store().sendDraft()}
          onStop={active ? () => void store().interrupt(active.threadId) : undefined}
          streaming={streaming}
          focusSeq={focusSeq}
          mentionSources={defaultMentionSources}
          skills={skills}
          toolbarLeft={
            <PermissionSelect value={settings?.permissionMode ?? 'ask'} disabled={!active} onChange={(mode) => active && void store().updateSettings(active.threadId, { permissionMode: mode })} />
          }
          toolbarRight={
            <>
              <ContextRing usage={view?.usage} disabled={!active} onCompact={active ? () => setDialog({ kind: 'compact', threadId: active.threadId }) : undefined} />
              <ModelSelect models={models} value={settings?.model} disabled={!active} onChange={(model) => active && void store().updateSettings(active.threadId, { model })} />
            </>
          }
        />
        <span className="font-latin text-micro leading-4 text-fg-3">© {new Date().getFullYear()} AIWC</span>
      </div>

      <ThreadDialogs
        dialog={dialog}
        onClose={() => setDialog(undefined)}
        onRename={(id, title) => store().rename(id, title)}
        onCompact={(id) => store().compact(id)}
        onClear={(id) => store().clearContext(id)}
        onDelete={(id) => store().remove(id)}
      />
    </div>
  )
}
