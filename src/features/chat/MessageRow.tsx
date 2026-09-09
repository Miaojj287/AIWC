/**
 * One message in the stream: avatar + name/time + bubble, hover toolbar (复制 / 引用到 Agent / 勾选 / 更多),
 * right-click menu, multi-select checkbox. System / recall rows render as a centred pill.
 * Visual truth: Figma 115:415 (messages) and 149:415 ⑥.
 */
import { AtSign, Clock, Copy, Ellipsis, SquareCheck, Trash } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import type { WxMessage } from '@aiwc/protocol'
import {
  Avatar,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  cn,
  type MenuSpec,
} from '@/kit'
import { formatClock, formatDateDivider } from '@/platform/format'
import { toMediaUrl } from './mediaUrl'
import { wechatEmoji } from './wechatEmoji'
import { MessageBody } from './MessageBody'
import { isNoticeKind } from './streamModel'

export interface MessageActions {
  onCopy(message: WxMessage): void
  onQuote(message: WxMessage): void
  onToggleSelect(message: WxMessage): void
  onJumpToTime(message: WxMessage): void
  onDeleteLocal(message: WxMessage): void
  onOpenImage(src: string, alt: string): void
}

export interface MessageRowProps extends MessageActions {
  message: WxMessage
  isGroup: boolean
  selectMode: boolean
  selected: boolean
  /** Flash highlight after a jump / search navigation. */
  focused: boolean
  highlight?: string
  selfAvatar?: string
  senderAvatar?: string
  /** Same sender as the previous message within a short gap: hide avatar / name. */
  continued: boolean
  mac: boolean
}

export function DayPill({ at }: { at: number }) {
  return (
    <div className="flex justify-center px-6 py-2">
      <span className="rounded-chip bg-raised px-2.5 py-0.5 font-latin text-micro text-fg-3">{formatDateDivider(at)}</span>
    </div>
  )
}

function NoticeRow({ message }: { message: WxMessage }) {
  return (
    <div data-message-id={message.id} className="flex justify-center px-6 py-3">
      <span className="max-w-[80%] whitespace-pre-wrap break-words px-2.5 py-0.5 text-center text-caption text-fg-3" title={message.text}>
        {wechatEmoji(message.text)}
      </span>
    </div>
  )
}

function buildMenu(message: WxMessage, actions: MessageActions, mac: boolean, selected: boolean): MenuSpec {
  return [
    { id: 'copy', label: '复制', icon: Copy, shortcut: mac ? '⌘C' : 'Ctrl+C', onSelect: () => actions.onCopy(message) },
    { id: 'quote', label: '引用到 Agent', icon: AtSign, shortcut: mac ? '⌘⇧A' : 'Ctrl+Shift+A', onSelect: () => actions.onQuote(message) },
    { id: 'select', label: selected ? '取消勾选' : '勾选', icon: SquareCheck, onSelect: () => actions.onToggleSelect(message) },
    { type: 'separator' },
    { id: 'jump', label: '跳转到时间', icon: Clock, description: '清除筛选，定位到这条消息', onSelect: () => actions.onJumpToTime(message) },
    { type: 'separator' },
    { id: 'delete', label: '删除本地缓存', icon: Trash, danger: true, onSelect: () => actions.onDeleteLocal(message) },
  ]
}

export const MessageRow = memo(function MessageRow({ message, isGroup, selectMode, selected, focused, highlight, selfAvatar, senderAvatar, continued, mac, ...actions }: MessageRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const self = message.isSelf
  const menu = useMemo(() => buildMenu(message, actions, mac, selected), [message, actions, mac, selected])

  if (isNoticeKind(message.kind)) return <NoticeRow message={message} />

  const bare = Boolean(message.rich) || message.kind === 'sticker' || message.kind === 'image' || message.kind === 'video'
  const bubbleClass = bare
    ? 'p-0'
    : self
      ? 'bg-bubble-self px-3.5 py-2 text-white'
      : 'border border-line-8 bg-panel px-3.5 py-2 text-fg'
  const toolbar = (
    <div
      className={cn(
        'absolute -top-7 z-10 hidden items-center gap-0.5 rounded-item border border-line-10 bg-overlay p-0.5 shadow-overlay',
        'group-hover:flex group-focus-within:flex',
        menuOpen && 'flex',
        self ? 'right-0' : 'left-0',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip content="复制">
        <IconButton size="sm" icon={Copy} label="复制" onClick={() => actions.onCopy(message)} />
      </Tooltip>
      <Tooltip content="引用到 Agent" kbd={mac ? '⌘⇧A' : 'Ctrl+Shift+A'}>
        <IconButton size="sm" icon={AtSign} label="引用到 Agent" onClick={() => actions.onQuote(message)} />
      </Tooltip>
      <Tooltip content={selected ? '取消勾选' : '勾选'}>
        <IconButton size="sm" icon={SquareCheck} label="勾选" active={selected} onClick={() => actions.onToggleSelect(message)} />
      </Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" icon={Ellipsis} label="更多" active={menuOpen} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={self ? 'end' : 'start'}>
          <DropdownMenuItems items={menu} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <div
      data-message-id={message.id}
      data-selected={selected || undefined}
      className={cn(
        'group relative flex items-end gap-2.5 px-6 transition-colors duration-(--dur-base)',
        continued ? 'py-0.5' : 'pb-0.5 pt-2.5',
        self && 'flex-row-reverse',
        selected && 'bg-accent-12/60',
        focused && 'bg-accent-15',
        selectMode && 'cursor-pointer',
      )}
      onClick={selectMode ? () => actions.onToggleSelect(message) : undefined}
    >
      {selectMode ? (
        <span className={cn('flex h-7 items-center', self ? 'order-last' : '')} onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={() => actions.onToggleSelect(message)} aria-label="勾选这条消息" />
        </span>
      ) : null}
      <div className="w-7 shrink-0 self-start pt-4">
        {continued ? null : <Avatar id={message.senderId} name={message.senderName ?? (self ? '我' : message.senderId)} src={self ? selfAvatar : senderAvatar} size={28} />}
      </div>
      <div className={cn('flex min-w-0 max-w-[72%] flex-col gap-1', self ? 'items-end' : 'items-start')}>
        {continued ? null : (
          <div className={cn('flex items-center gap-2 px-0.5 font-latin text-micro text-fg-3', self && 'flex-row-reverse')}>
            {!self && isGroup && message.senderName ? <span className="font-sans text-caption text-fg-2">{message.senderName}</span> : null}
            <time dateTime={new Date(message.createdAt).toISOString()}>{formatClock(message.createdAt)}</time>
          </div>
        )}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                'relative max-w-full text-bubble leading-[22px]',
                bare ? 'rounded-item' : self ? 'rounded-[10px] rounded-tr-[4px]' : 'rounded-[10px] rounded-tl-[4px]',
                bubbleClass,
              )}
            >
              {toolbar}
              <MessageBody message={message} self={self} highlight={highlight} onOpenImage={actions.onOpenImage} />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItems items={menu} />
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  )
})

export function avatarSrcOf(path: string | undefined): string | undefined {
  return toMediaUrl(path)
}
