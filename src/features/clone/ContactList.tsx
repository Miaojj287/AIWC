/**
 * ObjectList body for the AI 克隆 rail function (DESIGN-SPEC §4): dm contacts with clone status on the
 * second line; context menu differs per status. Figma 144:415 (left), board 153:415 ①.
 * 开始 / 重试 only open the clone Tab, whose confirm page says where the data goes and picks range and
 * model (CLAUDE.md §6); 取消克隆 asks the same question as the progress card.
 */
import { Bot, Ellipsis, Eye, MessageSquare, Quote, RefreshCw, Reply, Trash, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CloneStatus } from '@aiwc/protocol'
import {
  Avatar,
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
  cn,
  toast,
  type MenuSpec,
} from '@/kit'
import { runCommand } from '@/app/commands'
import { useT, type MessageKey } from '@/i18n'
import { formatTime } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { ObjectListProps } from '@/shell/objectListRegistry'
import { servableAvatar } from '@/shell/objectList/sessionListModel'
import { useShellStore } from '@/shell/shellStore'
import {
  cloneStatusLine,
  filterContacts,
  progressPercent,
  readyCount,
  type CloneListEntry,
  type CloneSegment,
} from './cloneView'
import { deleteImpactText } from './profileModel'
import { CancelCloneDialog } from './views/CloneDialogs'

export const CLONE_SEGMENTS: ReadonlyArray<{ id: CloneSegment; labelKey: MessageKey }> = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'ready', labelKey: 'clone.list.segments.ready' },
]

const TONE_CLASS = { ok: 'text-ok', accent: 'text-accent', danger: 'text-danger', neutral: 'text-fg-3' } as const
const DOT_CLASS = { ok: 'bg-ok', accent: 'bg-accent', danger: 'bg-danger', neutral: 'bg-fg-3' } as const

export function ContactList({ query, activeObjectId }: ObjectListProps) {
  const t = useT()
  const segmentId = useShellStore((s) => s.listSegment)
  const setSegment = useShellStore((s) => s.setListSegment)
  const segment: CloneSegment = segmentId === 'ready' ? 'ready' : 'all'
  const list = useInvoke('clone:list', undefined, [])
  const [live, setLive] = useState<Record<string, CloneStatus>>({})
  const [deleteTarget, setDeleteTarget] = useState<CloneListEntry | null>(null)
  /** The build the 取消克隆 dialog is about; `startedAt` keeps it from reopening for a later build. */
  const [cancelTarget, setCancelTarget] = useState<{ entry: CloneListEntry; startedAt: number } | null>(null)

  useBridgeEvent('clone:status', (e) => setLive((m) => ({ ...m, [e.contactId]: e.status })))
  useEffect(() => setLive({}), [list.data])

  const merged = useMemo<CloneListEntry[]>(
    () => (list.data ?? []).map((e) => ({ ...e, status: live[e.contactId] ?? e.status })),
    [list.data, live],
  )
  const entries = useMemo<CloneListEntry[]>(
    () => filterContacts(merged, query, segment).sort((a, b) => (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0)),
    [merged, query, segment],
  )
  const total = list.data?.length ?? 0
  const ready = readyCount(merged)
  // The dialog follows the live status: it closes by itself once that build finishes or fails.
  const cancelStatus = cancelTarget
    ? merged.find((e) => e.contactId === cancelTarget.entry.contactId)?.status
    : undefined
  const cancelProgress =
    cancelStatus?.state === 'building' && cancelStatus.progress.startedAt === cancelTarget?.startedAt
      ? cancelStatus.progress
      : undefined

  const open = (e: CloneListEntry) => runCommand('tab.openClone', { contactId: e.contactId, title: e.displayName })

  const cancel = async (e: CloneListEntry) => {
    try {
      await invoke('clone:cancel', { contactId: e.contactId })
      toast.info(t('clone.toast.cancelled', { name: e.displayName }))
    } catch (err) {
      toast.error(t('clone.toast.cancelCloneFailed'), { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const sync = async () => {
    try {
      const res = await invoke('substrate:sync', {})
      if (res.phase === 'error' && res.error) toast.error(t('clone.list.syncFailed'), { detail: res.error })
      else toast.success(t('clone.list.syncStarted'))
      list.reload()
    } catch (err) {
      toast.error(t('clone.list.syncFailed'), { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const remove = async (e: CloneListEntry) => {
    try {
      const res = await invoke('clone:delete', { contactId: e.contactId })
      toast.success(t('clone.toast.deleted', { name: e.displayName }), {
        detail: res.affectedRules.length ? t('clone.list.rulesReset', { n: res.affectedRules.length }) : undefined,
      })
      list.reload()
    } catch (err) {
      toast.error(t('clone.toast.deleteFailed'), { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const menuFor = (e: CloneListEntry): MenuSpec => {
    const common: MenuSpec = [
      {
        id: 'chat',
        label: t('clone.list.menu.viewChat'),
        icon: MessageSquare,
        onSelect: () => runCommand('tab.openChat', { sessionId: e.contactId, title: e.displayName }),
      },
      {
        id: 'quote',
        label: t('clone.list.menu.quote'),
        icon: Quote,
        onSelect: () => runCommand('agent.quote', { kind: 'contact', id: e.contactId, label: e.displayName }),
      },
    ]
    switch (e.status.state) {
      case 'ready':
        return [
          { id: 'talk', label: t('clone.actions.talk'), icon: Bot, onSelect: () => open(e) },
          { id: 'profile', label: t('clone.list.menu.viewProfile'), icon: Eye, onSelect: () => open(e) },
          {
            id: 'autoreply',
            label: t('clone.list.menu.useForAutoReply'),
            icon: Reply,
            onSelect: () => runCommand('tab.openAutoReply', { sessionId: e.contactId, title: e.displayName }),
          },
          { type: 'separator' },
          ...common,
          { type: 'separator' },
          { id: 'reclone', label: t('clone.actions.reclone'), icon: RefreshCw, onSelect: () => open(e) },
          {
            id: 'delete',
            label: t('clone.list.menu.delete'),
            icon: Trash,
            danger: true,
            onSelect: () => setDeleteTarget(e),
          },
        ]
      case 'building': {
        const { startedAt } = e.status.progress
        return [
          { id: 'progress', label: t('clone.list.menu.viewProgress'), icon: Eye, onSelect: () => open(e) },
          { type: 'separator' },
          ...common,
          { type: 'separator' },
          {
            id: 'cancel',
            label: t('clone.actions.cancel'),
            icon: X,
            danger: true,
            onSelect: () => setCancelTarget({ entry: e, startedAt }),
          },
        ]
      }
      default:
        return [
          {
            id: 'start',
            label: e.status.state === 'failed' ? t('clone.list.menu.retry') : t('clone.list.menu.start'),
            icon: Bot,
            onSelect: () => open(e),
          },
          { type: 'separator' },
          ...common,
        ]
    }
  }

  if (list.loading && !list.data) return <SkeletonListRows rows={6} className="px-2.5 py-2" />
  if (list.error)
    return (
      <EmptyState
        compact
        variant="error"
        title={t('clone.list.loadFailed')}
        description={list.error.message}
        action={{ label: t('common.retry'), onClick: list.reload }}
      />
    )
  if (total === 0) {
    return (
      <EmptyState
        compact
        variant="empty"
        title={t('clone.list.empty')}
        description={t('clone.list.emptyHint')}
        action={{ label: t('clone.list.syncNow'), onClick: () => void sync() }}
        secondaryAction={{
          label: t('clone.list.connectWechat'),
          onClick: () => runCommand('tab.openSettings', { page: 'account' }),
        }}
      />
    )
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        variant="no-results"
        title={query ? t('clone.list.noMatch', { query }) : t('clone.list.noneCloned')}
        description={query ? t('clone.list.dmOnly') : t('clone.list.pickFromAll')}
        action={segment !== 'all' ? { label: t('clone.list.viewAll'), onClick: () => setSegment(null) } : undefined}
        secondaryAction={
          query
            ? { label: t('clone.list.clearSearch'), onClick: () => useShellStore.getState().setListQuery('') }
            : undefined
        }
      />
    )
  }

  return (
    <div
      role="list"
      aria-label={t('clone.list.ariaLabel')}
      className="h-full min-h-0 overflow-y-auto overscroll-contain px-2 py-1.5"
    >
      <div className="flex items-center px-2.5 pb-1 text-micro text-fg-3">
        <span>
          {segment === 'ready' ? t('clone.list.countReady', { n: ready }) : t('clone.list.countAll', { total, ready })}
        </span>
      </div>
      {entries.map((e) => {
        const line = cloneStatusLine(e.status, e.messageCount)
        const spec = menuFor(e)
        return (
          <ContextMenu key={e.contactId}>
            <ContextMenuTrigger asChild>
              <ListItem
                role="listitem"
                leading={<Avatar id={e.contactId} name={e.displayName} src={servableAvatar(e.avatarPath)} />}
                title={e.displayName}
                subtitle={
                  <span className={cn('flex min-w-0 items-center gap-1.5', TONE_CLASS[line.tone])}>
                    {e.status.state === 'ready' || e.status.state === 'building' ? (
                      <span
                        aria-hidden
                        className={cn('inline-block size-1.5 shrink-0 rounded-chip', DOT_CLASS[line.tone])}
                      />
                    ) : null}
                    <span className="truncate" title={line.text}>
                      {line.text}
                    </span>
                  </span>
                }
                meta={formatTime(e.lastContactAt)}
                selected={activeObjectId === e.contactId}
                onSelect={() => open(e)}
                hoverActions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" icon={Ellipsis} label={t('clone.list.moreActions')} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItems items={spec} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItems items={spec} />
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <DangerDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('clone.deleteDialog.title', { name: deleteTarget?.displayName ?? '' })}
        description={deleteImpactText()}
        onConfirm={async () => {
          const t = deleteTarget
          setDeleteTarget(null)
          if (t) await remove(t)
        }}
      />
      <CancelCloneDialog
        open={cancelProgress !== undefined}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        percent={cancelProgress ? progressPercent(cancelProgress) : 0}
        onConfirm={() => {
          const target = cancelTarget
          setCancelTarget(null)
          if (target) void cancel(target.entry)
        }}
      />
    </div>
  )
}
