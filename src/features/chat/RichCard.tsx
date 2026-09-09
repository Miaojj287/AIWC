import { useState } from 'react'
import { ArrowLeftRight, Bell, FileText, Gift, Link, MapPin, Music, Play, UserRound } from 'lucide-react'
import type { WxRichContent } from '@aiwc/protocol'
import { cn, Dialog, DialogContent, DialogTitle, DialogDescription } from '@/kit'
import { openUrl } from '@/platform/openExternal'

const labels: Record<WxRichContent['type'], string> = { article: '公众号图文', link: '链接', miniProgram: '小程序', channel: '视频号', music: '音乐', chatHistory: '聊天记录', contact: '个人名片', location: '位置', transfer: '微信转账', redPacket: '微信红包', announcement: '群公告', gift: '微信礼物' }
const icons = { article: FileText, link: Link, miniProgram: Link, channel: Play, music: Music, chatHistory: FileText, contact: UserRound, location: MapPin, transfer: ArrowLeftRight, redPacket: Gift, announcement: Bell, gift: Gift }
function webUrl(url?: string) {
  try { return url && /^https?:$/.test(new URL(url).protocol) ? url : undefined } catch { return undefined }
}
function Cover({ url, large, label }: { url?: string; large?: boolean; label: string }) {
  const [failed, setFailed] = useState<string>()
  const src = webUrl(url)
  return <span className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-hover-5 text-fg-3', large ? 'h-36 w-full' : 'size-14 rounded-control')}>
    {src && failed !== src ? <img src={src} alt={label} referrerPolicy="no-referrer" onError={() => setFailed(src)} className="size-full object-cover" /> : <FileText size={24} aria-hidden />}
  </span>
}
export function RichCard({ rich }: { rich: WxRichContent }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = icons[rich.type]
  const warm = ['transfer', 'redPacket', 'gift'].includes(rich.type)
  const large = ['article', 'miniProgram', 'channel'].includes(rich.type)
  const url = webUrl(rich.url)
  const history = rich.type === 'chatHistory'
  const contents = <>
    {large && rich.coverUrl ? <Cover url={rich.coverUrl} label={rich.title} large /> : null}
    <span className="flex gap-3 p-3">
      {warm ? <Icon className="mt-1 shrink-0" size={28} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        {rich.amount ? <span className="text-title font-medium">{rich.amount}</span> : null}
        <span className="line-clamp-3 text-body font-medium leading-5">{rich.title}</span>
        {rich.description ? <span className={cn('line-clamp-3 whitespace-pre-wrap text-caption leading-[18px]', warm ? 'text-white/85' : 'text-fg-3')}>{rich.description}</span> : null}
        {rich.status ? <span className="text-caption">{rich.status}</span> : null}
      </span>
      {!large && !warm ? <Cover url={rich.coverUrl} label={rich.title} /> : null}
    </span>
    <span className={cn('flex items-center gap-1.5 border-t px-3 py-2 text-micro', warm ? 'border-white/20 text-white/90' : 'border-line-8 text-fg-3')}><Icon size={12} aria-hidden />{rich.source ? `${rich.source} · ` : ''}{labels[rich.type]}</span>
  </>
  const className = cn('block w-[280px] max-w-full overflow-hidden rounded-item border text-left', warm ? 'border-orange-400 bg-orange-500 text-white' : 'border-line-8 bg-panel text-fg')
  if (rich.type === 'article' && rich.entries?.length) return <div className={className}>
    {rich.entries.map((entry, i) => <RichCard key={`${entry.url}-${i}`} rich={{ ...rich, ...entry, entries: undefined }} />)}
  </div>
  return <>
    {url || history ? <button type="button" className={cn(className, 'transition-opacity hover:opacity-85 focus-visible:outline-accent')} aria-label={`${history ? '查看' : '打开'}${rich.title}`} onClick={(e) => { e.stopPropagation(); if (url) void openUrl(url); else setExpanded(true) }}>{contents}</button> : <div className={className}>{contents}</div>}
    {history ? <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent size="lg"><DialogTitle>{rich.title}</DialogTitle><DialogDescription>聊天记录</DialogDescription><div className="max-h-[65vh] space-y-4 overflow-y-auto">
      {rich.entries?.length ? rich.entries.map((entry, i) => <div key={i} className="rounded-item border border-line-8 p-3"><div className="mb-1 text-caption text-fg-3">{entry.title}</div><div className="whitespace-pre-wrap break-words text-body">{entry.description}</div></div>) : <p className="whitespace-pre-wrap text-body">{rich.description || '本地消息未包含可读取的聊天记录内容'}</p>}
    </div></DialogContent></Dialog> : null}
  </>
}
