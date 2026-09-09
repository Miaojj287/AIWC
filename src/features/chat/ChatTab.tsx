/**
 * 聊天预览 Tab (DESIGN-SPEC §1.2): header → sync bar (+ per-tab filters) → virtualised message stream →
 * bottom action bar, with the ⌘F search bar and the multi-select bar layered in. Talks to other
 * features only through commands (agent.quote / tab.openAutoReply / tab.openClone).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageAnchor, SearchHit, SyncStatus, WxMessage } from '@aiwc/protocol'
import { Button, DangerDialog, toast } from '@/kit'
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
import { DEFAULT_FILTERS, isFiltered, parseFilters, resolveRange, type ChatFilters, type ExportRangeMode } from './filters'
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
  const sessionId = tab.objectId
  const mac = detectMac()
  const filters = useMemo(() => parseFilters(tab.state?.filters), [tab.state?.filters])
  const filtersKey = JSON.stringify(filters)
  const setFilters = useCallback((next: ChatFilters) => update({ state: { ...tab.state, filters: next } }), [update, tab.state])

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
  const filteredStatsQ = useInvoke('substrate:stats', { sessionId, metric: 'overview', from: bounds.from, to: bounds.to }, [sessionId, filtersKey], { enabled: isFiltered(filters) })
  const filteredCounts = useMemo(() => readOverview(filteredStatsQ.data), [filteredStatsQ.data])
  const membersQ = useInvoke('substrate:listGroupMembers', { groupId: sessionId, limit: 500 }, [sessionId], { enabled: session?.kind === 'group' })

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
    () => (membersQ.data?.items ?? []).map((c) => ({ id: c.username, name: c.remark ?? c.nickname, src: toMediaUrl(c.avatarPath), detail: c.remark ? c.nickname : undefined })),
    [membersQ.data],
  )
  const senders = useMemo<SenderOption[]>(() => {
    if (session?.kind === 'group') return members.map((m) => ({ id: m.id, name: m.name, detail: m.detail, avatar: m.src }))
    const out: SenderOption[] = []
    if (account) out.push({ id: account.wxid, name: account.nickname ?? '我', detail: '我', avatar: toMediaUrl(account.avatarPath) })
    if (session && session.kind === 'dm') out.push({ id: session.id, name: session.title, avatar: toMediaUrl(session.avatarPath) })
    return out
  }, [session, members, account])

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
  useEffect(() => {
    if (!ui.focusMessageId) return
    const id = ui.focusMessageId
    const loaded = loadedById.get(id)
    goTo(loaded?.anchor ?? { sessionId, messageId: id, seq: 0, createdAt: 0 })
    clearFocus(tab.id)
  }, [ui.focusNonce, ui.focusMessageId, stream.loading, loadedById, goTo, clearFocus, tab.id, sessionId])
  useEffect(() => () => forget(tab.id), [forget, tab.id])

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
        const res = await invoke('substrate:search', { query: text, sessionIds: [sessionId], from: bounds.from, to: bounds.to, limit: 200, mode: 'keyword' })
        const sorted = [...res].sort((a, b) => b.message.seq - a.message.seq)
        setHits(sorted)
        setHitIdx(0)
        setLastQuery(text)
        const first = sorted[0]
        if (first) goTo(first.message.anchor)
        else toast.info('没有找到匹配的消息')
      } catch (e) {
        toast.error(`搜索失败：${errText(e)}`)
      } finally {
        setSearching(false)
      }
    },
    [sessionId, bounds, goTo],
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
      runCommand('agent.quote', { kind: 'session', id: sessionId, label: title, messageIds: ids.length ? ids : undefined })
      toast.success(ids.length ? `已把 ${ids.length} 条消息加入当前 Agent 会话上下文` : `已把「${title}」加入当前 Agent 会话上下文`)
    },
    [sessionId, title],
  )
  const onCopy = useCallback(async (m: WxMessage) => {
    if (await copyText(plainTextOf(m))) toast.success('已复制')
    else toast.error('复制失败，请检查剪贴板权限')
  }, [])
  const copySelection = async () => {
    const list = stream.messages.filter((m) => selected.has(m.id))
    if (await copyText(transcriptOf(list, account?.nickname ?? '我'))) toast.success(`已复制 ${list.length} 条消息`)
    else toast.error('复制失败，请检查剪贴板权限')
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
  const onSync = () => void invoke('substrate:sync', {}).catch((e: unknown) => toast.error(`同步失败：${errText(e)}`))
  const onRebuildIndex = () => {
    const id = toast.progress(`正在重新索引「${title}」…`)
    invoke('substrate:rebuildIndex', { sessionId })
      .then(() => {
        toast.update(id, { kind: 'success', text: `「${title}」已重新索引`, sticky: false })
        stream.reload()
      })
      .catch((e: unknown) => toast.update(id, { kind: 'error', text: `重建索引失败：${errText(e)}`, sticky: false }))
  }
  const removeIndex = async () => {
    setRemovingIndex(true)
    try {
      await invoke('substrate:removeIndex', { sessionId })
      setRemoveIndexOpen(false)
      toast.success(`已从索引中移除「${title}」`)
      stream.reload()
    } catch (e) {
      toast.error(`移除失败：${errText(e)}`)
    } finally {
      setRemovingIndex(false)
    }
  }

  const view = useMemo(() => syncView(sync, counts), [sync, counts])
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
      <SyncBar view={view} filters={filters} onFiltersChange={setFilters} senders={senders} sendersLoading={membersQ.loading} onSync={onSync} />
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
        title={`删除 ${deleteIds?.length ?? 0} 条本地记录？`}
        description="只删除 AIWC 的本地缓存与索引，不会影响微信里的原始消息。此操作不可撤销。"
        confirmLabel="删除"
        onConfirm={() => {
          // TODO(substrate owner): per-message local deletion has no IPC yet (substrate:removeIndex is per session).
          setDeleteIds(null)
          toast.info('暂不支持删除单条本地记录', { detail: '可在会话菜单中「从索引中移除」整个会话' })
        }}
      >
        {deleteIds && deleteIds.length > 0 ? (
          <div className="flex justify-end">
            <Button variant="link" size="sm" onClick={() => void copySelection()}>
              先复制这些消息
            </Button>
          </div>
        ) : null}
      </DangerDialog>
      <DangerDialog
        open={removeIndexOpen}
        onOpenChange={setRemoveIndexOpen}
        title={`从索引中移除「${title}」？`}
        description="会删除这个会话在本机的全部索引与缓存（消息、媒体、向量），微信里的数据不受影响。之后可以在会话菜单里重新索引。"
        confirmLabel="移除"
        loading={removingIndex}
        onConfirm={removeIndex}
      />
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
