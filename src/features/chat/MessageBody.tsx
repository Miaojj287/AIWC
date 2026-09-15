/**
 * Bubble content per message kind (DESIGN-SPEC §1.2: text / file / voice / image / system at minimum).
 * Text is linkified and search matches are highlighted; quotes render the quoted block above the text.
 */
import { ExternalLink, Link as LinkIcon } from 'lucide-react'
import type { WxMessage } from '@aiwc/protocol'
import { ICON_STROKE, cn } from '@/kit'
import { useT, type MessageKey } from '@/i18n'
import { openTarget } from '@/platform/openExternal'
import { wechatEmoji } from './wechatEmoji'
import { RichCard } from './RichCard'
import { segmentText } from './linkify'
import { FileBody, ImageBody, VideoBody, VoiceBody } from './MessageMedia'

export interface MessageBodyProps {
  message: WxMessage
  self: boolean
  highlight?: string
  onOpenImage(src: string, alt: string): void
}

function openExternal(href: string, what: string) {
  // Links leave the app through the shell (main decides how to open); never navigate the renderer.
  void openTarget(href, what)
}

export function RichText({
  text,
  self,
  highlight,
  className,
}: {
  text: string
  self: boolean
  highlight?: string
  className?: string
}) {
  const t = useT()
  const segments = segmentText(text, highlight)
  return (
    <span className={cn('select-text whitespace-pre-wrap break-words', className)}>
      {segments.map((seg, i) => {
        const display = seg.href ? seg.text : wechatEmoji(seg.text)
        const content = seg.mark ? <mark className="rounded-[4px] bg-accent-30 px-px text-fg">{display}</mark> : display
        if (seg.href) {
          const href = seg.href
          return (
            <a
              key={i}
              href={href}
              onClick={(e) => {
                e.preventDefault()
                openExternal(href, t('chat.openTarget.link'))
              }}
              className={cn(
                'underline decoration-current/40 underline-offset-2 hover:decoration-current',
                self ? 'text-white' : 'text-accent',
              )}
            >
              {content}
            </a>
          )
        }
        return <span key={i}>{content}</span>
      })}
    </span>
  )
}

export function MessageBody({ message, self, highlight, onOpenImage }: MessageBodyProps) {
  const t = useT()
  if (message.rich) return <RichCard rich={message.rich} self={self} />
  switch (message.kind) {
    case 'text':
      return <RichText text={message.text} self={self} highlight={highlight} />
    case 'quote':
      return (
        <div className="flex flex-col gap-1.5">
          {message.quote ? (
            <div
              className={cn(
                'rounded-control border-l-2 px-2 py-1 text-caption leading-[18px]',
                self ? 'border-white/40 bg-white/10 text-white/80' : 'border-(--line-25) bg-hover-5 text-fg-2',
              )}
            >
              {message.quote.senderName ? (
                <span className="font-medium">{t('chat.message.quoteSender', { name: message.quote.senderName })}</span>
              ) : null}
              <span className="select-text break-words">{message.quote.text}</span>
            </div>
          ) : null}
          <RichText text={message.text} self={self} highlight={highlight} />
        </div>
      )
    case 'image':
      return <ImageBody message={message} onOpen={onOpenImage} />
    case 'sticker':
      return <ImageBody message={message} onOpen={onOpenImage} sticker />
    case 'video':
      return <VideoBody message={message} onOpen={onOpenImage} />
    case 'voice':
      return <VoiceBody message={message} self={self} />
    case 'file':
      return <FileBody message={message} self={self} />
    case 'link':
      return (
        <span className={cn('flex items-start gap-2', self ? 'text-white' : 'text-fg')}>
          <LinkIcon size={14} strokeWidth={ICON_STROKE} aria-hidden className="mt-1 shrink-0 opacity-70" />
          <RichText text={message.text || t('chat.placeholder.link')} self={self} highlight={highlight} />
        </span>
      )
    case 'card':
    case 'location':
    case 'transfer':
    case 'other':
    default:
      return (
        <span className={cn('flex items-center gap-1.5', self ? 'text-white/85' : 'text-fg-2')}>
          <ExternalLink size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 opacity-70" />
          <RichText
            text={message.text || t(KIND_FALLBACK[message.kind] ?? 'chat.placeholder.message')}
            self={self}
            highlight={highlight}
          />
        </span>
      )
  }
}

const KIND_FALLBACK: Partial<Record<WxMessage['kind'], MessageKey>> = {
  card: 'chat.placeholder.card',
  location: 'chat.placeholder.location',
  transfer: 'chat.placeholder.transfer',
  other: 'chat.placeholder.unsupported',
}
