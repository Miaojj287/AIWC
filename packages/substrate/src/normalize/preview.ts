import type { MessageKind, WxMedia, WxMessage } from '@aiwc/protocol'

export const PREVIEW_MAX_CHARS = 80

export function collapseWhitespace(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

export function truncate(s: string, max: number = PREVIEW_MAX_CHARS): string {
  const t = collapseWhitespace(s)
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

/** One-line preview for a message kind + text + media, used for session lists and search snippets. */
export function previewText(kind: MessageKind, text: string, media?: WxMedia): string {
  const t = collapseWhitespace(text)
  switch (kind) {
    case 'text':
    case 'quote':
      return truncate(t)
    case 'image':
      return '[图片]'
    case 'voice':
      return media?.transcript ? `[语音] ${truncate(media.transcript, 60)}` : '[语音]'
    case 'video':
      return '[视频]'
    case 'file':
      return media?.fileName ? `[文件] ${truncate(media.fileName, 60)}` : t ? `[文件] ${truncate(t, 60)}` : '[文件]'
    case 'sticker':
      return '[动画表情]'
    case 'link':
      return t ? `[链接] ${truncate(t, 60)}` : '[链接]'
    case 'card':
      return t ? `[名片] ${truncate(t, 60)}` : '[名片]'
    case 'location':
      return t ? `[位置] ${truncate(t, 60)}` : '[位置]'
    case 'transfer':
      return t ? `[转账] ${truncate(t, 60)}` : '[转账]'
    case 'system':
      return t ? truncate(t) : '[系统消息]'
    case 'revoke':
      return t ? truncate(t) : '撤回了一条消息'
    case 'other':
    default:
      return t ? truncate(t) : '[消息]'
  }
}

export function previewOf(message: Pick<WxMessage, 'kind' | 'text' | 'media'>): string {
  return previewText(message.kind, message.text, message.media)
}

/** Whether the message carries searchable / embeddable text. */
export function isTextBearing(kind: MessageKind): boolean {
  return kind === 'text' || kind === 'quote' || kind === 'link' || kind === 'card' || kind === 'file' || kind === 'location' || kind === 'transfer' || kind === 'system'
}
