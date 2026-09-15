/**
 * Chat preview header (DESIGN-SPEC §1.2 ①): avatar 36 + title 14 Medium + meta 12 weak + `···` session menu
 * (会话信息 / 搜索 ⌘F / 导出 — 设置自动回复 / 克隆 — 重建索引 / 移除索引). Figma 119:xxx header, 149:415 ④.
 */
import { AtSign, Bot, Download, Ellipsis, Info, RefreshCw, Reply, Search, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { WxSession } from '@aiwc/protocol'
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Skeleton,
  type MenuSpec,
} from '@/kit'
import { useT } from '@/i18n'
import { formatDateTime, formatNumber } from '@/platform/format'
import { toMediaUrl } from './mediaUrl'
import type { OverviewCounts } from './syncModel'

export interface ChatHeaderActions {
  onSearch(): void
  onExport(): void
  onAutoReply(): void
  onClone(): void
  onRebuildIndex(): void
  onRemoveIndex(): void
  onQuoteSession(): void
}

export interface ChatHeaderProps extends ChatHeaderActions {
  session: WxSession | undefined
  meta: string
  counts: OverviewCounts | undefined
  mac: boolean
  members?: Array<{ id: string; name: string; src?: string }>
}

export function ChatHeader({ session, meta, counts, mac, members, ...actions }: ChatHeaderProps) {
  const t = useT()
  const [infoOpen, setInfoOpen] = useState(false)
  const menu = useMemo<MenuSpec>(
    () => [
      { id: 'info', label: t('chat.header.menu.info'), icon: Info, onSelect: () => setInfoOpen(true) },
      {
        id: 'search',
        label: t('chat.header.menu.search'),
        icon: Search,
        shortcut: mac ? '⌘F' : 'Ctrl+F',
        onSelect: actions.onSearch,
      },
      { id: 'export', label: t('chat.header.menu.export'), icon: Download, onSelect: actions.onExport },
      { type: 'separator' },
      { id: 'autoreply', label: t('chat.header.autoReply'), icon: Reply, onSelect: actions.onAutoReply },
      {
        id: 'clone',
        label: session?.kind === 'dm' ? t('chat.header.menu.cloneContact') : t('chat.header.menu.clone'),
        icon: Bot,
        disabled: session?.kind !== 'dm',
        description: session?.kind !== 'dm' ? t('chat.header.menu.cloneDmOnly') : undefined,
        onSelect: actions.onClone,
      },
      {
        id: 'quote',
        label: t('chat.actions.quoteToAgent'),
        icon: AtSign,
        shortcut: mac ? '⌘⇧A' : 'Ctrl+Shift+A',
        onSelect: actions.onQuoteSession,
      },
      { type: 'separator' },
      { id: 'rebuild', label: t('chat.header.menu.rebuildIndex'), icon: RefreshCw, onSelect: actions.onRebuildIndex },
      {
        id: 'remove',
        label: t('chat.header.menu.removeIndex'),
        icon: Trash,
        danger: true,
        onSelect: actions.onRemoveIndex,
      },
    ],
    [mac, session?.kind, actions, t],
  )

  return (
    <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-4">
      <Popover open={infoOpen} onOpenChange={setInfoOpen}>
        <PopoverAnchor asChild>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {session ? (
              <Avatar
                id={session.id}
                name={session.title}
                src={toMediaUrl(session.avatarPath)}
                size={36}
                members={session.kind === 'group' ? members : undefined}
              />
            ) : (
              <Skeleton className="size-9 rounded-item" />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              {session ? (
                <>
                  <div className="truncate text-bubble font-medium leading-5 text-fg">{session.title}</div>
                  <div className="truncate text-caption leading-4 text-fg-3">{meta}</div>
                </>
              ) : (
                <>
                  <Skeleton className="h-3 w-[120px] rounded-chip" />
                  <Skeleton className="h-2.5 w-[180px] rounded-chip bg-line-6" />
                </>
              )}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" sideOffset={8} className="w-[300px]">
          {session ? (
            <SessionInfo
              session={session}
              counts={counts}
              members={members}
              onAutoReply={actions.onAutoReply}
              onClose={() => setInfoOpen(false)}
            />
          ) : null}
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={Ellipsis} label={t('chat.header.actions')} disabled={!session} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItems items={menu} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-caption">
      <span className="shrink-0 text-fg-3">{label}</span>
      <span className="min-w-0 truncate font-latin text-fg">{value}</span>
    </div>
  )
}

function SessionInfo({
  session,
  counts,
  members,
  onAutoReply,
  onClose,
}: {
  session: WxSession
  counts: OverviewCounts | undefined
  members?: ChatHeaderProps['members']
  onAutoReply(): void
  onClose(): void
}) {
  const t = useT()
  const kind = t('chat.sessionKind', { kind: session.kind })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar
          id={session.id}
          name={session.title}
          src={toMediaUrl(session.avatarPath)}
          size={44}
          members={session.kind === 'group' ? members : undefined}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate text-bubble font-medium text-fg">{session.title}</div>
          <div className="truncate text-caption text-fg-3">
            {kind}
            {session.memberCount ? ` · ${t('chat.meta.members', { n: session.memberCount })}` : ''}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line-6 pt-2.5">
        <InfoRow
          label={t('chat.header.info.messages')}
          value={
            counts
              ? t('chat.header.info.messageCount', { count: formatNumber(counts.total) })
              : session.indexedCount !== undefined
                ? t('chat.header.info.messageCount', { count: formatNumber(session.indexedCount) })
                : '—'
          }
        />
        <InfoRow
          label={t('chat.header.info.media')}
          value={
            counts
              ? `${formatNumber(counts.imageCount)} / ${formatNumber(counts.fileCount)} / ${formatNumber(counts.voiceCount)}`
              : '—'
          }
        />
        <InfoRow
          label={t('chat.header.info.indexedUntil')}
          value={session.indexedUntil ? formatDateTime(session.indexedUntil) : t('chat.meta.notIndexed')}
        />
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="shrink-0 text-fg-3">wxid</span>
          <span className="min-w-0 truncate font-mono text-fg-2" title={session.id}>
            {session.id}
          </span>
        </div>
      </div>
      {members && members.length > 0 ? (
        <div className="flex items-center gap-1 border-t border-line-6 pt-2.5">
          {members.slice(0, 8).map((m) => (
            <Avatar key={m.id} id={m.id} name={m.name} src={m.src} size={20} />
          ))}
          {members.length > 8 ? <Badge tone="neutral">+{members.length - 8}</Badge> : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-0.5">
        <Button
          size="sm"
          variant="ghost"
          icon={Reply}
          onClick={() => {
            onClose()
            onAutoReply()
          }}
        >
          {t('chat.header.autoReply')}
        </Button>
      </div>
    </div>
  )
}
