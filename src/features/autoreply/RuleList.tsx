/**
 * ObjectList body for the 自动回复 rail function (DESIGN-SPEC §3 左列): every session with its rule status
 * on the second line and a Toggle to start / pause the rule. Figma 143:415 (left), board 152:415 ①.
 */
import { Clock, Copy, Ellipsis, MessageSquare, Pause, Pencil, Play, Plus, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AutoReplyRule, WxSession } from '@aiwc/protocol'
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
  Toggle,
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
import { CopyRuleDialog } from './editor/CopyRuleDialog'
import { matchesSegment, ruleStatusLine, type RuleSegment } from './ruleModel'

export const RULE_SEGMENTS: ReadonlyArray<{ id: RuleSegment; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'on', label: '已开启' },
  { id: 'paused', label: '已暂停' },
]

interface Row {
  session: WxSession
  rule: AutoReplyRule | undefined
}

const STATUS_RANK = { on: 0, paused: 1, unset: 2 } as const

export function RuleList({ query, activeObjectId }: ObjectListProps) {
  const segmentId = useShellStore((s) => s.listSegment)
  const setSegment = useShellStore((s) => s.setListSegment)
  const segment: RuleSegment = RULE_SEGMENTS.some((s) => s.id === segmentId) ? (segmentId as RuleSegment) : 'all'
  const sessions = useInvoke('substrate:listSessions', { limit: 500, kind: 'all' }, [])
  const rules = useInvoke('autoreply:listRules', undefined, [])
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [copyTarget, setCopyTarget] = useState<Row | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)

  useBridgeEvent('autoreply:rulesChanged', () => rules.reload())
  useBridgeEvent('autoreply:record', () => rules.reload())
  useBridgeEvent('substrate:event', (e) => {
    if (e.type === 'sessions.changed') sessions.reload()
  })

  const rows = useMemo<Row[]>(() => {
    const bySession = new Map((rules.data ?? []).map((r) => [r.sessionId, r]))
    const q = query.trim().toLowerCase()
    return (sessions.data?.items ?? [])
      .filter((s) => s.kind === 'dm' || s.kind === 'group')
      .map((s) => {
        const rule = bySession.get(s.id)
        const enabled = optimistic[s.id]
        return { session: s, rule: rule && enabled !== undefined ? { ...rule, enabled } : rule }
      })
      .filter((r) => !q || r.session.title.toLowerCase().includes(q) || r.session.id.toLowerCase().includes(q))
      .filter((r) => matchesSegment(r.rule, segment))
      .sort((a, b) => STATUS_RANK[ruleStatusLine(a.rule).kind] - STATUS_RANK[ruleStatusLine(b.rule).kind] || (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0))
  }, [sessions.data, rules.data, query, segment, optimistic])

  const open = (row: Row) => runCommand('tab.openAutoReply', { sessionId: row.session.id, title: row.session.title })

  const toggle = async (row: Row, enabled: boolean) => {
    if (!row.rule) return open(row)
    setOptimistic((o) => ({ ...o, [row.session.id]: enabled }))
    try {
      await invoke('autoreply:setEnabled', { sessionId: row.session.id, enabled })
      toast.success(enabled ? `已启用「${row.session.title}」的自动回复` : `已暂停「${row.session.title}」的自动回复`, {
        detail: enabled ? '对方若还有没回的消息，会先补回一条' : undefined,
      })
    } catch (e) {
      toast.error('切换失败', { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setOptimistic((o) => {
        const next = { ...o }
        delete next[row.session.id]
        return next
      })
      rules.reload()
    }
  }

  const remove = async (row: Row) => {
    try {
      await invoke('autoreply:deleteRule', { sessionId: row.session.id })
      toast.success(`已删除「${row.session.title}」的自动回复规则`)
      rules.reload()
    } catch (e) {
      toast.error('删除失败', { detail: e instanceof Error ? e.message : String(e) })
    }
  }

  const menuFor = (row: Row): MenuSpec => {
    if (!row.rule) {
      return [
        { id: 'create', label: '设置自动回复', icon: Plus, onSelect: () => open(row) },
        { id: 'chat', label: '查看聊天记录', icon: MessageSquare, onSelect: () => runCommand('tab.openChat', { sessionId: row.session.id, title: row.session.title }) },
      ]
    }
    const rule = row.rule
    return [
      { id: 'edit', label: '编辑规则', icon: Pencil, onSelect: () => open(row) },
      rule.enabled ? { id: 'pause', label: '暂停规则', icon: Pause, onSelect: () => void toggle(row, false) } : { id: 'resume', label: '启用规则', icon: Play, onSelect: () => void toggle(row, true) },
      { id: 'copy', label: '复制规则到…', icon: Copy, onSelect: () => setCopyTarget(row) },
      { id: 'records', label: '查看回复记录', icon: Clock, onSelect: () => open(row) },
      { type: 'separator' },
      { id: 'chat', label: '查看聊天记录', icon: MessageSquare, onSelect: () => runCommand('tab.openChat', { sessionId: row.session.id, title: row.session.title }) },
      { type: 'separator' },
      { id: 'delete', label: '删除规则', icon: Trash, danger: true, onSelect: () => setDeleteTarget(row) },
    ]
  }

  const loading = (sessions.loading && !sessions.data) || (rules.loading && !rules.data)
  if (loading) return <SkeletonListRows rows={6} className="px-2.5 py-2" />
  if (sessions.error || rules.error) {
    return <EmptyState compact variant="error" title="加载失败" description={(sessions.error ?? rules.error)?.message} action={{ label: '重试', onClick: () => { sessions.reload(); rules.reload() } }} />
  }
  if ((sessions.data?.items.length ?? 0) === 0) return <EmptyState compact variant="empty" title="还没有可设置的会话" description="连接微信并完成同步后，会话会出现在这里" />
  if (rows.length === 0) {
    const label = RULE_SEGMENTS.find((s) => s.id === segment)?.label ?? ''
    return (
      <EmptyState
        compact
        variant="no-results"
        title={query ? `没有匹配「${query}」的会话` : `没有${label}的规则`}
        description={segment !== 'all' ? '切换到「全部」查看所有会话' : undefined}
        action={segment !== 'all' ? { label: '查看全部', onClick: () => setSegment(null) } : undefined}
      />
    )
  }

  return (
    <div role="list" aria-label="自动回复规则" className="h-full min-h-0 overflow-y-auto overscroll-contain px-2 py-1.5">
      {rows.map((row) => {
        const status = ruleStatusLine(row.rule)
        const spec = menuFor(row)
        return (
          <ContextMenu key={row.session.id}>
            <ContextMenuTrigger asChild>
              <ListItem
                role="listitem"
                leading={<Avatar id={row.session.id} name={row.session.title} src={servableAvatar(row.session.avatarPath)} />}
                title={row.session.title}
                subtitle={
                  <span className={cn('flex items-center gap-1.5 truncate', status.kind === 'on' && 'text-ok', status.kind === 'paused' && row.rule && 'text-fg-3')}>
                    {row.rule ? <span className={cn('inline-block size-1.5 shrink-0 rounded-chip', status.kind === 'on' ? 'bg-ok' : 'bg-fg-3')} aria-hidden /> : null}
                    <span className="truncate">{status.text}</span>
                  </span>
                }
                meta={row.rule ? undefined : formatTime(row.session.lastMessageAt)}
                selected={activeObjectId === row.session.id}
                onSelect={() => open(row)}
                trailing={row.rule ? <Toggle label={`${row.session.title} 自动回复`} checked={row.rule.enabled} onCheckedChange={(v) => void toggle(row, v)} onClick={(e) => e.stopPropagation()} /> : undefined}
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
      {copyTarget?.rule ? <CopyRuleDialog open rule={copyTarget.rule} sourceTitle={copyTarget.session.title} onOpenChange={(o) => !o && setCopyTarget(null)} onCopied={() => rules.reload()} /> : null}
      <DangerDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`删除「${deleteTarget?.session.title ?? ''}」的规则？`}
        description="回复方式与设定会被删除，历史回复记录保留。"
        onConfirm={async () => {
          const t = deleteTarget
          setDeleteTarget(null)
          if (t) await remove(t)
        }}
      />
    </div>
  )
}
