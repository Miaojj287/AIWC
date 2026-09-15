/**
 * ObjectList body for the 自动回复 rail function (DESIGN-SPEC §3 左列): every session with its rule status
 * on the second line and a Toggle to start / pause the rule. Figma 143:415 (left), board 152:415 ①.
 * Chats are paged and searched on the backend (like the chat list); rule rows are always complete.
 */
import { Clock, Copy, Ellipsis, MessageSquare, Pause, Pencil, Play, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VList, type VListHandle } from 'virtua'
import {
  Avatar,
  Badge,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  ListItem,
  SkeletonListRows,
  Toggle,
  cn,
  toast,
  type MenuSpec,
} from '@/kit'
import { runCommand } from '@/app/commands'
import { startReplyDesk, useReplyDeskStore } from '@/features/replydesk/store'
import { useT, type MessageKey } from '@/i18n'
import { formatTime } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { ObjectListProps } from '@/shell/objectListRegistry'
import { servableAvatar } from '@/shell/objectList/sessionListModel'
import { useShellStore } from '@/shell/shellStore'
import { CopyRuleDialog } from './editor/CopyRuleDialog'
import { buildRuleRows, type RuleRow } from './ruleListModel'
import { ruleStatusLine, type RuleSegment } from './ruleModel'
import { usePagedSessions, useSessionsById } from './sessionPaging'

export const RULE_SEGMENTS: ReadonlyArray<{ id: RuleSegment; labelKey: MessageKey }> = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'on', labelKey: 'autoreply.list.segments.on' },
  { id: 'paused', labelKey: 'autoreply.list.segments.paused' },
]

/** Fetch the next page once the viewport is this close to the end of the loaded rows. */
const LOAD_MORE_THRESHOLD_PX = 240
/** Below this many rows keep paging without waiting for a scroll: ~30 × 56px overflows even a tall window. */
const MIN_FILLED_ROWS = 30

const FOOTER = 'footer' as const

export function RuleList({ query, activeObjectId }: ObjectListProps) {
  const t = useT()
  const segmentId = useShellStore((s) => s.listSegment)
  const setSegment = useShellStore((s) => s.setListSegment)
  const segment: RuleSegment = RULE_SEGMENTS.some((s) => s.id === segmentId) ? (segmentId as RuleSegment) : 'all'
  const page = usePagedSessions(query)
  const { hasMore, loadMore, reload: reloadPages } = page
  const rules = useInvoke('autoreply:listRules', undefined, [])
  const [sessionsTick, setSessionsTick] = useState(0)
  const ruleSessionIds = useMemo(() => (rules.data ?? []).map((r) => r.sessionId), [rules.data])
  // Resolve only once the rules are known, so their rows arrive together instead of popping in above the list.
  const rulesKnown = rules.data !== undefined
  const ruleSessions = useSessionsById(ruleSessionIds, sessionsTick, rulesKnown)
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [copyTarget, setCopyTarget] = useState<RuleRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null)
  const listRef = useRef<VListHandle>(null)
  // Parked replies (sendMode 'confirm') waiting for a click, per chat — the reply-desk store already
  // follows every draft push, so the badge is live without another IPC round.
  const drafts = useReplyDeskStore((s) => s.state.drafts)
  useEffect(() => {
    void startReplyDesk()
  }, [])
  const parkedBySession = useMemo(() => {
    const out = new Map<string, number>()
    for (const d of drafts)
      if (d.state === 'pending' && d.mode === 'confirm' && d.ruleId)
        out.set(d.source.chatId, (out.get(d.source.chatId) ?? 0) + 1)
    return out
  }, [drafts])

  const refreshSessions = useCallback(() => {
    reloadPages()
    setSessionsTick((n) => n + 1)
  }, [reloadPages])
  useBridgeEvent('autoreply:rulesChanged', () => rules.reload())
  useBridgeEvent('autoreply:record', () => rules.reload())
  useBridgeEvent('substrate:event', (e) => {
    if (e.type === 'sessions.changed' || (e.type === 'connection' && e.state === 'ready')) refreshSessions()
  })

  const rows = useMemo<RuleRow[]>(
    () =>
      buildRuleRows({
        rules: (rules.data ?? []).map((rule) => {
          const enabled = optimistic[rule.sessionId]
          return enabled === undefined ? rule : { ...rule, enabled }
        }),
        ruleSessions: ruleSessions.sessions,
        pageSessions: page.items,
        query,
        segment,
        parked: parkedBySession,
      }),
    [rules.data, optimistic, ruleSessions.sessions, page.items, query, segment, parkedBySession],
  )

  // Chats without a rule only show in 全部; there, keep paging until the rows overflow the viewport.
  const loadMoreNearEnd = useCallback(() => {
    if (segment !== 'all' || !hasMore) return
    const list = listRef.current
    if (list && list.scrollOffset + list.viewportSize >= list.scrollSize - LOAD_MORE_THRESHOLD_PX) loadMore()
  }, [segment, hasMore, loadMore])
  useEffect(() => {
    if (segment === 'all' && hasMore && rows.length < MIN_FILLED_ROWS) loadMore()
    else loadMoreNearEnd()
  }, [segment, hasMore, rows.length, loadMore, loadMoreNearEnd])

  const open = (row: RuleRow) =>
    runCommand('tab.openAutoReply', { sessionId: row.session.id, title: row.session.title })

  const toggle = async (row: RuleRow, enabled: boolean) => {
    if (!row.rule) return open(row)
    setOptimistic((o) => ({ ...o, [row.session.id]: enabled }))
    try {
      await invoke('autoreply:setEnabled', { sessionId: row.session.id, enabled })
      toast.success(
        enabled
          ? t('autoreply.rule.enabledToast', { name: row.session.title })
          : t('autoreply.rule.pausedToast', { name: row.session.title }),
        {
          detail: enabled ? t('autoreply.rule.enabledToastDetail') : undefined,
        },
      )
    } catch (e) {
      toast.error(t('autoreply.rule.toggleFailed'), { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setOptimistic((o) => {
        const next = { ...o }
        delete next[row.session.id]
        return next
      })
      rules.reload()
    }
  }

  const remove = async (row: RuleRow) => {
    try {
      await invoke('autoreply:deleteRule', { sessionId: row.session.id })
      toast.success(t('autoreply.rule.deletedToast', { name: row.session.title }))
      rules.reload()
    } catch (e) {
      toast.error(t('autoreply.rule.deleteFailed'), { detail: e instanceof Error ? e.message : String(e) })
    }
  }

  const menuFor = (row: RuleRow): MenuSpec => {
    if (!row.rule) {
      return [
        { id: 'create', label: t('autoreply.list.setUp'), icon: Plus, onSelect: () => open(row) },
        {
          id: 'chat',
          label: t('autoreply.list.viewChatHistory'),
          icon: MessageSquare,
          onSelect: () => runCommand('tab.openChat', { sessionId: row.session.id, title: row.session.title }),
        },
      ]
    }
    const rule = row.rule
    return [
      { id: 'edit', label: t('autoreply.list.editRule'), icon: Pencil, onSelect: () => open(row) },
      rule.enabled
        ? { id: 'pause', label: t('autoreply.rule.pause'), icon: Pause, onSelect: () => void toggle(row, false) }
        : { id: 'resume', label: t('autoreply.rule.enable'), icon: Play, onSelect: () => void toggle(row, true) },
      { id: 'copy', label: t('autoreply.list.copyRuleTo'), icon: Copy, onSelect: () => setCopyTarget(row) },
      { id: 'records', label: t('autoreply.list.viewRecords'), icon: Clock, onSelect: () => open(row) },
      { type: 'separator' },
      {
        id: 'chat',
        label: t('autoreply.list.viewChatHistory'),
        icon: MessageSquare,
        onSelect: () => runCommand('tab.openChat', { sessionId: row.session.id, title: row.session.title }),
      },
      { type: 'separator' },
      {
        id: 'delete',
        label: t('autoreply.rule.delete'),
        icon: Trash,
        danger: true,
        onSelect: () => setDeleteTarget(row),
      },
    ]
  }

  const loading = page.loading || (rules.loading && !rulesKnown) || (rulesKnown && ruleSessions.loading)
  if (loading) return <SkeletonListRows rows={6} className="px-2.5 py-2" />
  const loadError = rules.error ?? ruleSessions.error ?? (rows.length === 0 ? page.error : undefined)
  if (loadError) {
    return (
      <EmptyState
        compact
        variant="error"
        title={t('autoreply.list.loadFailed')}
        description={loadError.message}
        action={{
          label: t('common.retry'),
          onClick: () => {
            refreshSessions()
            rules.reload()
          },
        }}
      />
    )
  }
  if (rows.length === 0) {
    // 全部 may still be paging past chats that cannot carry a rule (official accounts).
    if (segment === 'all' && (hasMore || page.loadingMore)) return <SkeletonListRows rows={6} className="px-2.5 py-2" />
    if (segment === 'all' && !query.trim())
      return (
        <EmptyState
          compact
          variant="empty"
          title={t('autoreply.list.emptyTitle')}
          description={t('autoreply.list.emptyDescription')}
        />
      )
    return (
      <EmptyState
        compact
        variant="no-results"
        title={
          query.trim() ? t('autoreply.list.noMatch', { query }) : t('autoreply.list.noRulesInSegment', { segment })
        }
        description={segment !== 'all' ? t('autoreply.list.switchToAllHint') : undefined}
        action={segment !== 'all' ? { label: t('autoreply.list.viewAll'), onClick: () => setSegment(null) } : undefined}
      />
    )
  }

  const showFooter = segment === 'all' && (page.loadingMore || Boolean(page.error))
  const data: ReadonlyArray<RuleRow | typeof FOOTER> = showFooter ? [...rows, FOOTER] : rows

  return (
    <>
      <VList
        ref={listRef}
        data={data}
        onScroll={loadMoreNearEnd}
        onScrollEnd={loadMoreNearEnd}
        role="list"
        aria-label={t('autoreply.list.ariaLabel')}
        className="h-full overscroll-contain px-2 py-1.5"
        style={{ height: '100%' }}
      >
        {(item) =>
          item === FOOTER ? (
            <div key={FOOTER} className="py-1">
              {page.error ? (
                <EmptyState
                  compact
                  variant="error"
                  title={t('autoreply.list.loadFailed')}
                  description={page.error.message}
                  action={{ label: t('common.retry'), onClick: reloadPages }}
                />
              ) : (
                <SkeletonListRows rows={2} className="px-0.5" />
              )}
            </div>
          ) : (
            <RuleListRow
              key={item.session.id}
              row={item}
              parked={parkedBySession.get(item.session.id) ?? 0}
              selected={activeObjectId === item.session.id}
              menu={menuFor(item)}
              onOpen={() => open(item)}
              onToggle={(enabled) => void toggle(item, enabled)}
            />
          )
        }
      </VList>
      {copyTarget?.rule ? (
        <CopyRuleDialog
          open
          rule={copyTarget.rule}
          sourceTitle={copyTarget.session.title}
          onOpenChange={(o) => !o && setCopyTarget(null)}
          onCopied={() => rules.reload()}
        />
      ) : null}
      <DangerDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('autoreply.rule.deleteTitle', { name: deleteTarget?.session.title ?? '' })}
        description={t('autoreply.rule.deleteDescription')}
        onConfirm={async () => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) await remove(target)
        }}
      />
    </>
  )
}

interface RuleListRowProps {
  row: RuleRow
  /** Replies of this chat waiting for 确认发送. */
  parked: number
  selected: boolean
  /** Shared by `···` and right-click (CLAUDE.md §4.2). */
  menu: MenuSpec
  onOpen: () => void
  onToggle: (enabled: boolean) => void
}

function RuleListRow({ row, parked, selected, menu, onOpen, onToggle }: RuleListRowProps) {
  const t = useT()
  const status = ruleStatusLine(row.rule)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          role="listitem"
          leading={<Avatar id={row.session.id} name={row.session.title} src={servableAvatar(row.session.avatarPath)} />}
          title={row.session.title}
          subtitle={
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5',
                status.kind === 'on' && 'text-ok',
                status.kind === 'paused' && row.rule && 'text-fg-3',
              )}
            >
              {parked > 0 ? (
                <Badge tone="warn">{t('autoreply.list.parkedBadge', { n: parked })}</Badge>
              ) : row.rule ? (
                <span
                  className={cn(
                    'inline-block size-1.5 shrink-0 rounded-chip',
                    status.kind === 'on' ? 'bg-ok' : 'bg-fg-3',
                  )}
                  aria-hidden
                />
              ) : null}
              <span className="truncate" title={status.text}>
                {status.text}
              </span>
            </span>
          }
          meta={row.rule ? undefined : formatTime(row.session.lastMessageAt)}
          selected={selected}
          onSelect={onOpen}
          trailing={
            row.rule ? (
              <Toggle
                label={t('autoreply.list.toggleLabel', { name: row.session.title })}
                checked={row.rule.enabled}
                onCheckedChange={onToggle}
                onClick={(e) => e.stopPropagation()}
              />
            ) : undefined
          }
          hoverActions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Ellipsis} label={t('autoreply.rule.moreActions')} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItems items={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
