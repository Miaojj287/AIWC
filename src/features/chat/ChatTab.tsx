/**
 * 聊天预览 Tab (DESIGN-SPEC §1.2): header → sync bar (+ per-tab filters) → virtualised message stream →
 * bottom action bar, with the ⌘F search bar and the multi-select bar layered in. Talks to other
 * features only through commands (agent.quote / tab.openAutoReply / tab.openClone).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageAnchor, SearchHit, SyncStatus, WxMessage } from '@aiwc/protocol'
import { Button, DangerDialog, toast } from '@/kit'
import { useT } from '@/i18n'
import { runCommand } from '@/app/commands'
import { detectMac } from '@/app/shortcuts'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { BottomBar, SearchBar, SelectionBar } from './ChatBars'
import { ChatHeader } from './ChatHeader'
import { ExportDialog } from './ExportDialog'
import { Lightbox } from './Lightbox'
import { MessageStream } from './MessageStream'
import { SyncBar } from './SyncBar'
import type { SenderOption } from './SenderFilter'
import { selectChatUi, useChatUiStore } from './chatStore'
import {
  DEFAULT_FILTERS,
  isFiltered,
  parseFilters,
  resolveRange,
  type ChatFilters,
  type ExportRangeMode,
} from './filters'
import { planFocus } from './focusPlan'
import { toMediaUrl } from './mediaUrl'
import { buildRows, plainTextOf, selectAllState, selectableIds, transcriptOf } from './streamModel'
import { readOverview, sessionMeta, syncView } from './syncModel'
import { useMessages } from './useMessages'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function ChatTab({ tab, update }: TabRendererProps) {
  const t = useT()
  const sessionId = tab.objectId
  const mac = detectMac()
  const filters = useMemo(() => parseFilters(tab.state?.filters), [tab.state?.filters])
  const filtersKey = JSON.stringify(filters)
  const setFilters = useCallback(
    (next: ChatFilters) => update({ state: { ...tab.state, filters: next } }),
    [update, tab.state],
  )

  /* ------------------------------------------------------------ session / status / stats */
  const sessionQ = useInvoke('substrate:getSession', { id: sessionId }, [sessionId])
  const session = sessionQ.data
  const statusQ = useInvoke('substrate:status', undefined, [])
  const [sync, setSync] = useState<SyncStatus | undefined>()
  useEffect(() => {
    if (statusQ.data) setSync(statusQ.data.sync)
  }, [statusQ.data])
  const account = statusQ.data?.account
  const statsQ = useInvoke('substrate:stats', { sessionId, metric: 'overview' }, [sessionId])
  const counts = useMemo(() => readOverview(statsQ.data), [statsQ.data])
  const bounds = useMemo(() => resolveRange(filters.range), [filters])
  const filteredStatsQ = useInvoke(
    'substrate:stats',
    { sessionId, metric: 'overview', from: bounds.from, to: bounds.to },
    [sessionId, filtersKey],
    { enabled: isFiltered(filters) },
  )
  const filteredCounts = useMemo(() => readOverview(filteredStatsQ.data), [filteredStatsQ.data])
  const membersQ = useInvoke('substrate:listGroupMembers', { groupId: sessionId, limit: 500 }, [sessionId], {
    enabled: session?.kind === 'group',
  })

  useEffect(() => {
    if (session && session.title !== tab.title) update({ title: session.title })
  }, [session, tab.title, update])

  useBridgeEvent('substrate:event', (ev) => {
    if (ev.type === 'sync') {
      setSync(ev.status)
      if (ev.status.phase === 'idle') statsQ.reload()
    } else if (ev.type === 'sessions.changed') {
      sessionQ.reload()
    } else if (ev.type === 'messages.changed' && ev.sessionIds.includes(sessionId)) {
      statsQ.reload()
      sessionQ.reload()
    }
  })

  const members = useMemo(
    () =>
      (membersQ.data?.items ?? []).map((c) => ({
        id: c.username,
        name: c.remark ?? c.nickname,
        src: toMediaUrl(c.avatarPath),
        detail: c.remark ? c.nickname : undefined,
      })),
    [membersQ.data],
  )
  const senders = useMemo<SenderOption[]>(() => {
    if (session?.kind === 'group')
      return members.map((m) => ({ id: m.id, name: m.name, detail: m.detail, avatar: m.src }))
    const out: SenderOption[] = []
    if (account)
      out.push({
        id: account.wxid,
        name: account.nickname ?? t('common.me'),
        detail: t('common.me'),
        avatar: toMediaUrl(account.avatarPath),
      })
    if (session && session.kind === 'dm')
      out.push({ id: session.id, name: session.title, avatar: toMediaUrl(session.avatarPath) })
    return out
  }, [session, members, account, t])

  /* --------------------------------------------------------------------------- messages */
  const pendingJump = useRef<MessageAnchor | undefined>(undefined)
  const stream = useMessages(sessionId, filters, {
    takePendingJump: () => {
      const a = pendingJump.current
      pendingJump.current = undefined
      return a
    },
  })
  const rows = useMemo(() => buildRows(stream.messages), [stream.messages])
  const loadedById = useMemo(() => new Map(stream.messages.map((m) => [m.id, m])), [stream.messages])

  const [focus, setFocus] = useState<{ id: string; nonce: number } | undefined>()
  const nonce = useRef(0)
  const focusMessage = useCallback((id: string) => setFocus({ id, nonce: ++nonce.current }), [])
  useEffect(() => {
    if (stream.pendingFocusId) {
      focusMessage(stream.pendingFocusId)
      stream.consumeFocus()
    }
  }, [stream.pendingFocusId, stream.consumeFocus, focusMessage, stream])
  const onFocused = useCallback(() => setFocus(undefined), [])

  const goTo = useCallback(
    (anchor: MessageAnchor) => {
      if (loadedById.has(anchor.messageId)) focusMessage(anchor.messageId)
      else void stream.jumpTo(anchor)
    },
    [loadedById, focusMessage, stream],
  )

  // Focus requests from tab.openChat (the caller only knows the message id). The shell merges
  // `focusMessageId` into tab.state; we move it into the ephemeral store so re-opens can focus again.
  const ui = useChatUiStore(selectChatUi(tab.id))
  const clearFocus = useChatUiStore((s) => s.clearFocus)
  const requestFocus = useChatUiStore((s) => s.requestFocus)
  const forget = useChatUiStore((s) => s.forget)
  const stateFocus = typeof tab.state?.focusMessageId === 'string' ? tab.state.focusMessageId : undefined
  useEffect(() => {
    if (!stateFocus) return
    requestFocus(tab.id, stateFocus)
    const { focusMessageId: _drop, ...rest } = tab.state ?? {}
    update({ state: rest })
  }, [stateFocus, requestFocus, tab.id, tab.state, update])
  // Only the id is known here, so resolve the real anchor before loading a window (see focusPlan.ts).
  // Refs keep a late lookup from acting on a stale window, filters or tab state.
  const loadedRef = useRef(loadedById)
  loadedRef.current = loadedById
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const setFiltersRef = useRef(setFilters)
  setFiltersRef.current = setFilters
  const focusRequest = useRef(0)
  const jumpTo = stream.jumpTo
  const focusById = useCallback(
    async (id: string) => {
      const mine = ++focusRequest.current
      const plan = await planFocus(id, {
        loaded: (x) => loadedRef.current.get(x),
        fetch: (x) => invoke('substrate:getMessage', { sessionId, messageId: x }),
        filtered: () => isFiltered(filtersRef.current),
      })
      if (mine !== focusRequest.current) return
      if (plan.kind === 'focus') focusMessage(plan.id)
      else if (plan.kind === 'jump') void jumpTo(plan.anchor)
      else if (plan.kind === 'jump-unfiltered') {
        pendingJump.current = plan.anchor
        setFiltersRef.current(DEFAULT_FILTERS)
        toast.info(t('chat.toast.filtersCleared'))
      } else toast.warning(t('chat.toast.messageNotFound'), { detail: t('chat.toast.messageNotFoundDetail') })
    },
    [sessionId, focusMessage, jumpTo, t],
  )
  useEffect(() => {
    if (!ui.focusMessageId) return
    const id = ui.focusMessageId
    clearFocus(tab.id)
    void focusById(id)
  }, [ui.focusNonce, ui.focusMessageId, focusById, clearFocus, tab.id])
  useEffect(
    () => () => {
      focusRequest.current += 1
      forget(tab.id)
    },
    [forget, tab.id],
  )

  /* -------------------------------------------------------------------------- selection */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const selectMode = selected.size > 0
  const toggleSelect = useCallback((m: WxMessage) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(m.id)) next.delete(m.id)
      else next.add(m.id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  useEffect(() => clearSelection(), [sessionId, filtersKey, clearSelection])

  /* ----------------------------------------------------------------------------- search */
  const openSearch = useChatUiStore((s) => s.openSearch)
  const closeSearch = useChatUiStore((s) => s.closeSearch)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | undefined>()
  const [hitIdx, setHitIdx] = useState(0)
  const [lastQuery, setLastQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const runSearch = useCallback(
    async (q: string) => {
      const text = q.trim()
      if (!text) {
        setHits(undefined)
        return
      }
      setSearching(true)
      try {
        const res = await invoke('substrate:search', {
          query: text,
          sessionIds: [sessionId],
          from: bounds.from,
          to: bounds.to,
          limit: 200,
          mode: 'keyword',
        })
        const sorted = [...res].sort((a, b) => b.message.seq - a.message.seq)
        setHits(sorted)
        setHitIdx(0)
        setLastQuery(text)
        const first = sorted[0]
        if (first) goTo(first.message.anchor)
        else toast.info(t('chat.toast.noSearchMatches'))
      } catch (e) {
        toast.error(t('chat.toast.searchFailed', { error: errText(e) }))
      } finally {
        setSearching(false)
      }
    },
    [sessionId, bounds, goTo, t],
  )
  const stepHit = (dir: 1 | -1) => {
    if (!hits || hits.length === 0) return
    const next = (hitIdx + dir + hits.length) % hits.length
    setHitIdx(next)
    const hit = hits[next]
    if (hit) goTo(hit.message.anchor)
  }
  const highlight = ui.searchOpen && query.trim() ? query.trim() : undefined

  /* ---------------------------------------------------------------------------- dialogs */
  const [exportOpen, setExportOpen] = useState(false)
  const [exportMode, setExportMode] = useState<ExportRangeMode | undefined>()
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [removeIndexOpen, setRemoveIndexOpen] = useState(false)
  const [removingIndex, setRemovingIndex] = useState(false)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  /* ---------------------------------------------------------------------------- actions */
  const title = session?.title ?? tab.title
  const quote = useCallback(
    (ids: string[]) => {
      runCommand('agent.quote', {
        kind: 'session',
        id: sessionId,
        label: title,
        messageIds: ids.length ? ids : undefined,
      })
      toast.success(
        ids.length ? t('chat.toast.quotedMessages', { n: ids.length }) : t('chat.toast.quotedSession', { title }),
      )
    },
    [sessionId, title, t],
  )
  const onCopy = useCallback(
    async (m: WxMessage) => {
      if (await copyText(plainTextOf(m))) toast.success(t('chat.toast.copied'))
      else toast.error(t('chat.toast.copyFailed'))
    },
    [t],
  )
  const copySelection = async () => {
    const list = stream.messages.filter((m) => selected.has(m.id))
    if (await copyText(transcriptOf(list, account?.nickname ?? t('common.me'))))
      toast.success(t('chat.toast.copiedMessages', { n: list.length }))
    else toast.error(t('chat.toast.copyFailed'))
  }
  const onJumpToTime = useCallback(
    (m: WxMessage) => {
      if (isFiltered(filters)) {
        pendingJump.current = m.anchor
        setFilters(DEFAULT_FILTERS)
      } else {
        void stream.jumpTo(m.anchor)
      }
    },
    [filters, setFilters, stream],
  )
  const onSync = () =>
    void invoke('substrate:sync', {}).catch((e: unknown) =>
      toast.error(t('chat.toast.syncFailed', { error: errText(e) })),
    )
  const onRebuildIndex = () => {
    const id = toast.progress(t('chat.toast.reindexing', { title }))
    invoke('substrate:rebuildIndex', { sessionId })
      .then(() => {
        toast.update(id, { kind: 'success', text: t('chat.toast.reindexed', { title }), sticky: false })
        stream.reload()
      })
      .catch((e: unknown) =>
        toast.update(id, { kind: 'error', text: t('chat.toast.reindexFailed', { error: errText(e) }), sticky: false }),
      )
  }
  const removeIndex = async () => {
    setRemovingIndex(true)
    try {
      await invoke('substrate:removeIndex', { sessionId })
      setRemoveIndexOpen(false)
      toast.success(t('chat.toast.removedFromIndex', { title }))
      stream.reload()
    } catch (e) {
      toast.error(t('chat.toast.removeFailed', { error: errText(e) }))
    } finally {
      setRemovingIndex(false)
    }
  }

  // syncView words its text through the module-level t(), so the language (t) is a real input here.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t: re-derive the sync text after a language switch
  const view = useMemo(() => syncView(sync, counts), [sync, counts, t])
  const meta = session ? sessionMeta(session) : ''
  const allState = selectAllState(stream.messages, selected)
  const streamEmpty = stream.loading || stream.messages.length === 0
  const messageActions = useMemo(
    () => ({
      onCopy: (m: WxMessage) => void onCopy(m),
      onQuote: (m: WxMessage) => quote([m.id]),
      onToggleSelect: toggleSelect,
      onJumpToTime,
      onDeleteLocal: (m: WxMessage) => setDeleteIds([m.id]),
      onOpenImage: (src: string, alt: string) => setLightbox({ src, alt }),
    }),
    [onCopy, quote, toggleSelect, onJumpToTime],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <ChatHeader
        session={session}
        meta={meta}
        counts={counts}
        mac={mac}
        members={members}
        onSearch={() => openSearch(tab.id)}
        onExport={() => {
          setExportMode(undefined)
          setExportOpen(true)
        }}
        onAutoReply={() => runCommand('tab.openAutoReply', { sessionId, title })}
        onClone={() => runCommand('tab.openClone', { contactId: sessionId, title })}
        onRebuildIndex={onRebuildIndex}
        onRemoveIndex={() => setRemoveIndexOpen(true)}
        onQuoteSession={() => quote([])}
      />
      {ui.searchOpen ? (
        <SearchBar
          query={query}
          onQueryChange={(q) => {
            setQuery(q)
            if (!q.trim()) setHits(undefined)
          }}
          onSubmit={(q) => (hits && hits.length > 0 && q.trim() === lastQuery ? stepHit(1) : void runSearch(q))}
          onClose={() => closeSearch(tab.id)}
          searching={searching}
          hitCount={hits?.length}
          currentIndex={hitIdx}
          onPrev={() => stepHit(-1)}
          onNext={() => stepHit(1)}
        />
      ) : null}
      <SyncBar
        view={view}
        filters={filters}
        onFiltersChange={setFilters}
        senders={senders}
        sendersLoading={membersQ.loading}
        onSync={onSync}
      />
      {selectMode ? (
        <SelectionBar
          count={selected.size}
          onQuote={() => quote([...selected])}
          onExport={() => {
            setExportMode('selected')
            setExportOpen(true)
          }}
          onDelete={() => setDeleteIds([...selected])}
          onCancel={clearSelection}
        />
      ) : null}
      <MessageStream
        rows={rows}
        loading={stream.loading}
        error={stream.error}
        hasOlder={stream.hasOlder}
        loadingOlder={stream.loadingOlder}
        hasNewer={stream.hasNewer}
        loadingNewer={stream.loadingNewer}
        lastChange={stream.lastChange}
        windowKey={stream.windowKey}
        focusId={focus?.id ?? stream.pendingFocusId}
        focusNonce={focus?.nonce ?? 0}
        onFocused={onFocused}
        onLoadOlder={stream.loadOlder}
        onLoadNewer={stream.loadNewer}
        onRetry={stream.reload}
        isGroup={session?.kind === 'group'}
        selectMode={selectMode}
        selectedIds={selected}
        highlight={highlight}
        selfAvatar={toMediaUrl(account?.avatarPath)}
        peerAvatar={toMediaUrl(session?.avatarPath)}
        senderAvatars={new Map(members.map((m) => [m.id, m.src]))}
        mac={mac}
        filtered={isFiltered(filters)}
        {...messageActions}
      />
      <BottomBar
        allState={allState}
        onToggleAll={(next) => setSelected(next ? new Set(selectableIds(stream.messages)) : new Set())}
        onExport={() => {
          setExportMode(undefined)
          setExportOpen(true)
        }}
        onDelete={() => setDeleteIds(selected.size ? [...selected] : selectableIds(stream.messages))}
        onQuote={() => quote([...selected])}
        disabled={streamEmpty}
        selectedCount={selected.size}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        sessionId={sessionId}
        sessionTitle={title}
        filters={filters}
        selectedIds={selected}
        filteredCount={filteredCounts?.total}
        totalCount={counts?.total ?? session?.indexedCount}
        initialMode={exportMode}
      />
      <DangerDialog
        open={deleteIds !== null}
        onOpenChange={(o) => !o && setDeleteIds(null)}
        title={t('chat.deleteDialog.title', { n: deleteIds?.length ?? 0 })}
        description={t('chat.deleteDialog.description')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          // TODO(substrate owner): per-message local deletion has no IPC yet (substrate:removeIndex is per session).
          setDeleteIds(null)
          toast.info(t('chat.deleteDialog.unsupported'), { detail: t('chat.deleteDialog.unsupportedDetail') })
        }}
      >
        {deleteIds && deleteIds.length > 0 ? (
          <div className="flex justify-end">
            <Button variant="link" size="sm" onClick={() => void copySelection()}>
              {t('chat.deleteDialog.copyFirst')}
            </Button>
          </div>
        ) : null}
      </DangerDialog>
      <DangerDialog
        open={removeIndexOpen}
        onOpenChange={setRemoveIndexOpen}
        title={t('chat.removeIndexDialog.title', { title })}
        description={t('chat.removeIndexDialog.description')}
        confirmLabel={t('common.remove')}
        loading={removingIndex}
        onConfirm={removeIndex}
      />
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
