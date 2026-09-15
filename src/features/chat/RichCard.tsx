import { useState } from 'react'
import {
  ArrowLeftRight,
  CircleCheck,
  CircleArrowLeft,
  Bell,
  FileText,
  Gift,
  Link,
  MapPin,
  Music,
  Play,
  UserRound,
} from 'lucide-react'
import type { WxRichContent } from '@aiwc/protocol'
import { cn, Dialog, DialogContent, DialogTitle, DialogDescription } from '@/kit'
import { catalogs } from '@aiwc/i18n'
import { useT, type MessageKey, type Translator } from '@/i18n'
import { openUrl } from '@/platform/openExternal'

const labels: Record<WxRichContent['type'], MessageKey> = {
  article: 'chat.rich.types.article',
  link: 'chat.rich.types.link',
  miniProgram: 'chat.rich.types.miniProgram',
  channel: 'chat.rich.types.channel',
  music: 'chat.rich.types.music',
  chatHistory: 'chat.rich.types.chatHistory',
  contact: 'chat.rich.types.contact',
  location: 'chat.rich.types.location',
  transfer: 'chat.rich.types.transfer',
  redPacket: 'chat.rich.types.redPacket',
  announcement: 'chat.rich.types.announcement',
  gift: 'chat.rich.types.gift',
}
const icons = {
  article: FileText,
  link: Link,
  miniProgram: Link,
  channel: Play,
  music: Music,
  chatHistory: FileText,
  contact: UserRound,
  location: MapPin,
  transfer: ArrowLeftRight,
  redPacket: Gift,
  announcement: Bell,
  gift: Gift,
}
/**
 * substrate fills titles / transfer statuses with fixed Chinese labels when WeChat's XML has none. They
 * stay data (search and the model read them); display maps them through `chat.rich.defaults`, whose
 * zh-CN values are exactly those labels. Real titles pass through untouched.
 */
const DEFAULT_LABELS = new Map<string, MessageKey>(
  Object.entries(catalogs['zh-CN'].chat.rich.defaults).map(([name, value]) => [
    value,
    `chat.rich.defaults.${name}` as MessageKey,
  ]),
)
const shown = (t: Translator, value: string | undefined): string | undefined => {
  const key = value ? DEFAULT_LABELS.get(value) : undefined
  return key ? t(key) : value
}
const TRANSFER_DEFAULTS = catalogs['zh-CN'].chat.rich.defaults

function webUrl(url?: string) {
  try {
    return url && /^https?:$/.test(new URL(url).protocol) ? url : undefined
  } catch {
    return undefined
  }
}
function Cover({ url, large, label }: { url?: string; large?: boolean; label: string }) {
  const [failed, setFailed] = useState<string>()
  const src = webUrl(url)
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden bg-hover-5 text-fg-3',
        large ? 'h-36 w-full' : 'size-14 rounded-control',
      )}
    >
      {src && failed !== src ? (
        <img
          src={src}
          alt={label}
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          className="size-full object-cover"
        />
      ) : (
        <FileText size={24} aria-hidden />
      )}
    </span>
  )
}
function TransferCard({ rich, self }: { rich: WxRichContent; self: boolean }) {
  const t = useT()
  const received = rich.status === TRANSFER_DEFAULTS.statusReceived || rich.status === TRANSFER_DEFAULTS.statusAccepted
  const returned = rich.status === TRANSFER_DEFAULTS.statusReturned
  const settled = received || returned
  const StatusIcon = received ? CircleCheck : returned ? CircleArrowLeft : ArrowLeftRight
  const amount = rich.amount?.replace(/^[¥￥]\s*/, '¥')
  return (
    <div
      className={cn(
        'relative w-[248px] max-w-full rounded-[6px] px-[14px] pb-[9px] pt-[14px] text-left',
        settled ? 'bg-[#ad7028] text-[#d5aa73]' : 'bg-[#f59b38] text-white',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[14px] size-[8px] rotate-45 rounded-[1px] bg-inherit',
          self ? '-right-[4px]' : '-left-[4px]',
        )}
      />
      <div className="flex items-center gap-[12px]">
        <StatusIcon size={37} strokeWidth={1.5} className="shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium leading-[21px]">{amount || t('chat.rich.transfer')}</div>
          <div className="mt-[1px] truncate text-[12px] leading-[18px]">
            {shown(t, rich.status) || t('chat.rich.transfer')}
            {!settled && rich.title !== TRANSFER_DEFAULTS.transfer ? ` · ${rich.title}` : ''}
          </div>
        </div>
      </div>
      <div className="mt-[12px] text-[12px] leading-[17px]">{t('chat.rich.types.transfer')}</div>
    </div>
  )
}

export function RichCard({ rich, self = false }: { rich: WxRichContent; self?: boolean }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  if (rich.type === 'transfer') return <TransferCard rich={rich} self={self} />
  const Icon = icons[rich.type]
  const warm = ['transfer', 'redPacket', 'gift'].includes(rich.type)
  const large = ['article', 'miniProgram', 'channel'].includes(rich.type)
  const url = webUrl(rich.url)
  const history = rich.type === 'chatHistory'
  const title = shown(t, rich.title) ?? ''
  const contents = (
    <>
      {large && rich.coverUrl ? <Cover url={rich.coverUrl} label={title} large /> : null}
      <span className="flex gap-3 p-3">
        {warm ? <Icon className="mt-1 shrink-0" size={28} /> : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          {rich.amount ? <span className="text-title font-medium">{rich.amount}</span> : null}
          <span className="line-clamp-3 text-body font-medium leading-5">{title}</span>
          {rich.description ? (
            <span
              className={cn(
                'line-clamp-3 whitespace-pre-wrap text-caption leading-[18px]',
                warm ? 'text-white/85' : 'text-fg-3',
              )}
            >
              {shown(t, rich.description)}
            </span>
          ) : null}
          {rich.status ? <span className="text-caption">{shown(t, rich.status)}</span> : null}
        </span>
        {!large && !warm ? <Cover url={rich.coverUrl} label={title} /> : null}
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5 border-t px-3 py-2 text-micro',
          warm ? 'border-white/20 text-white/90' : 'border-line-8 text-fg-3',
        )}
      >
        <Icon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">
          {rich.source ? `${rich.source} · ` : ''}
          {t(labels[rich.type])}
        </span>
      </span>
    </>
  )
  const className = cn(
    'block w-[280px] max-w-full overflow-hidden rounded-item border text-left',
    warm ? 'border-orange-400 bg-orange-500 text-white' : 'border-line-8 bg-panel text-fg',
  )
  if (rich.type === 'article' && rich.entries?.length)
    return (
      <div className={className}>
        {rich.entries.map((entry, i) => (
          <RichCard key={`${entry.url}-${i}`} rich={{ ...rich, ...entry, entries: undefined }} />
        ))}
      </div>
    )
  return (
    <>
      {url || history ? (
        <button
          type="button"
          className={cn(className, 'transition-opacity hover:opacity-85 focus-visible:outline-accent')}
          aria-label={history ? t('chat.rich.view', { title }) : t('chat.rich.open', { title })}
          onClick={(e) => {
            e.stopPropagation()
            if (url) void openUrl(url)
            else setExpanded(true)
          }}
        >
          {contents}
        </button>
      ) : (
        <div className={className}>{contents}</div>
      )}
      {history ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent size="lg">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('chat.rich.types.chatHistory')}</DialogDescription>
            <div className="max-h-[65vh] space-y-4 overflow-y-auto">
              {rich.entries?.length ? (
                rich.entries.map((entry, i) => (
                  <div key={i} className="rounded-item border border-line-8 p-3">
                    <div className="mb-1 text-caption text-fg-3">{shown(t, entry.title)}</div>
                    <div className="whitespace-pre-wrap break-words text-body">{shown(t, entry.description)}</div>
                  </div>
                ))
              ) : (
                <p className="whitespace-pre-wrap text-body">{rich.description || t('chat.rich.historyEmpty')}</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
