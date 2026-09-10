/**
 * ObjectList body for the AI 克隆 rail function (DESIGN-SPEC §4): dm contacts with clone status on the
 * second line; context menu differs per status. Figma 144:415 (left), board 153:415 ①.
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
import { formatTime } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { ObjectListProps } from '@/shell/objectListRegistry'
import { servableAvatar } from '@/shell/objectList/sessionListModel'
import { useShellStore } from '@/shell/shellStore'
import { cloneStatusLine, filterContacts, readyCount, type CloneListEntry, type CloneSegment } from './cloneView'
import { deleteImpactText } from './profileModel'

export const CLONE_SEGMENTS: ReadonlyArray<{ id: CloneSegment; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'ready', label: '已克隆' },
]

const TONE_CLASS = { ok: 'text-ok', accent: 'text-accent', danger: 'text-danger', neutral: 'text-fg-3' } as const
const DOT_CLASS = { ok: 'bg-ok', accent: 'bg-accent', danger: 'bg-danger', neutral: 'bg-fg-3' } as const

export function ContactList({ query, activeObjectId }: ObjectListProps) {
  const segmentId = useShellStore((s) => s.listSegment)
  const setSegment = useShellStore((s) => s.setListSegment)
  const segment: CloneSegment = segmentId === 'ready' ? 'ready' : 'all'
  const list = useInvoke('clone:list', undefined, [])
  const [live, setLive] = useState<Record<string, CloneStatus>>({})
  const [deleteTarget, setDeleteTarget] = useState<CloneListEntry | null>(null)

  useBridgeEvent('clone:status', (e) => setLive((m) => ({ ...m, [e.contactId]: e.status })))
  useEffect(() => setLive({}), [list.data])

  const entries = useMemo<CloneListEntry[]>(() => {
    const merged = (list.data ?? []).map((e) => ({ ...e, status: live[e.contactId] ?? e.status }))
    return filterContacts(merged, query, segment).sort((a, b) => (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0))
  }, [list.data, live, query, segment])
  const total = list.data?.length ?? 0
  const ready = readyCount((list.data ?? []).map((e) => ({ ...e, status: live[e.contactId] ?? e.status })))


  const open = (e: CloneListEntry) => runCommand('tab.openClone', { contactId: e.contactId, title: e.displayName })

  const start = async (e: CloneListEntry) => {
    try {
      await invoke('clone:start', { contactId: e.contactId })
      open(e)
    } catch (err) {
      toast.error('无法开始克隆', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const cancel = async (e: CloneListEntry) => {
    try {
      await invoke('clone:cancel', { contactId: e.contactId })
      toast.info(`已取消克隆「${e.displayName}」`)
    } catch (err) {
      toast.error('取消克隆失败', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const sync = async () => {
    try {
      const res = await invoke('substrate:sync', {})
      if (res.phase === 'error' && res.error) toast.error('同步失败', { detail: res.error })
      else toast.success('已开始同步微信数据')
      list.reload()
    } catch (err) {
      toast.error('同步失败', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const remove = async (e: CloneListEntry) => {
    try {
      const res = await invoke('clone:delete', { contactId: e.contactId })
      toast.success(`已删除「${e.displayName}」的分身`, { detail: res.affectedRules.length ? `${res.affectedRules.length} 条自动回复规则已改为默认助理` : undefined })
      list.reload()
    } catch (err) {
      toast.error('删除失败', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const menuFor = (e: CloneListEntry): MenuSpec => {
    const common: MenuSpec = [
      { id: 'chat', label: '查看聊天记录', icon: MessageSquare, onSelect: () => runCommand('tab.openChat', { sessionId: e.contactId, title: e.displayName }) },
      { id: 'quote', label: '引用到 Agent', icon: Quote, onSelect: () => runCommand('agent.quote', { kind: 'contact', id: e.contactId, label: e.displayName }) },
    ]
    switch (e.status.state) {
      case 'ready':
        return [
          { id: 'talk', label: '和分身聊聊', icon: Bot, onSelect: () => open(e) },
          { id: 'profile', label: '查看人格画像', icon: Eye, onSelect: () => open(e) },
          { id: 'autoreply', label: '用于自动回复…', icon: Reply, onSelect: () => runCommand('tab.openAutoReply', { sessionId: e.contactId, title: e.displayName }) },
          { type: 'separator' },
          ...common,
          { type: 'separator' },
          { id: 'reclone', label: '重新克隆', icon: RefreshCw, onSelect: () => open(e) },
          { id: 'delete', label: '删除克隆', icon: Trash, danger: true, onSelect: () => setDeleteTarget(e) },
        ]
      case 'building':
        return [
          { id: 'progress', label: '查看进度', icon: Eye, onSelect: () => open(e) },
          { type: 'separator' },
          ...common,
          { type: 'separator' },
          { id: 'cancel', label: '取消克隆', icon: X, danger: true, onSelect: () => void cancel(e) },
        ]
      default:
        return [
          { id: 'start', label: e.status.state === 'failed' ? '重试克隆' : '开始克隆', icon: Bot, onSelect: () => void start(e) },
          { type: 'separator' },
          ...common,
        ]
    }
  }

  if (list.loading && !list.data) return <SkeletonListRows rows={6} className="px-2.5 py-2" />
  if (list.error) return <EmptyState compact variant="error" title="加载联系人失败" description={list.error.message} action={{ label: '重试', onClick: list.reload }} />
  if (total === 0) {
    return (
      <EmptyState
        compact
        variant="empty"
        title="还没有可克隆的联系人"
        description="AI 克隆只支持单聊联系人。连接微信并完成一次同步后，联系人会出现在这里。"
        action={{ label: '立即同步', onClick: () => void sync() }}
        secondaryAction={{ label: '去连接微信', onClick: () => runCommand('tab.openSettings', { page: 'account' }) }}
      />
    )
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        variant="no-results"
        title={query ? `没有匹配「${query}」的联系人` : '还没有已克隆的联系人'}
        description={query ? '只显示单聊联系人，群聊不可克隆' : `共 ${total} 位联系人可以克隆，切到「全部」挑一位开始`}
        action={segment !== 'all' ? { label: '查看全部联系人', onClick: () => setSegment(null) } : undefined}
        secondaryAction={query ? { label: '清空搜索', onClick: () => useShellStore.getState().setListQuery('') } : undefined}
      />
    )
  }

  return (
    <div role="list" aria-label="联系人" className="h-full min-h-0 overflow-y-auto overscroll-contain px-2 py-1.5">
      <div className="flex items-center px-2.5 pb-1 text-micro text-fg-3">
        <span>{segment === 'ready' ? `已克隆 ${ready} 位` : `共 ${total} 位联系人 · 已克隆 ${ready} 位`}</span>
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
                  <span className={cn('flex items-center gap-1.5 truncate', TONE_CLASS[line.tone])}>
                    {e.status.state === 'ready' || e.status.state === 'building' ? <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-chip', DOT_CLASS[line.tone])} /> : null}
                    <span className="truncate">{line.text}</span>
                  </span>
                }
                meta={formatTime(e.lastContactAt)}
                selected={activeObjectId === e.contactId}
                onSelect={() => open(e)}
                hoverActions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" icon={Ellipsis} label="更多操作" />
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
        title={`删除「${deleteTarget?.displayName ?? ''}」的分身？`}
        description={deleteImpactText()}
        onConfirm={async () => {
          const t = deleteTarget
          setDeleteTarget(null)
          if (t) await remove(t)
        }}
      />
    </div>
  )
}
