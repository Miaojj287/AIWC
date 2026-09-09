/**
 * iLink Bot API wire types + pure parsing helpers (protocol reference: Tencent/openclaw-weixin).
 * No I/O in this file so every function is fixture-testable.
 */
import { createHash } from 'node:crypto'
import type { InboundKind } from '@aiwc/protocol'

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const ILINK_BOT_TYPE = '3'
/** Aligned with the official plugin so the server marks this client as a legitimate, connected channel. */
export const ILINK_CHANNEL_VERSION = '2.4.4'
export const ILINK_APP_ID = 'bot'
export const ILINK_BOT_AGENT = 'OpenClaw'
export const ILINK_TEXT_BUBBLE_SEPARATOR = '---wx-next---'
export const ILINK_MAX_TEXT_LENGTH = 4000

export const UploadMediaType = { IMAGE: 1, VIDEO: 2, FILE: 3, VOICE: 4 } as const
export const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const
/** message_type on inbound updates: 1 = from the user, 2 = from the bot (echo). */
export const IlinkMessageType = { USER: 1, BOT: 2 } as const

export interface IlinkSession {
  token: string
  baseUrl: string
  botId: string
  userId: string
}

export interface IlinkQrcode {
  qrcode: string
  /** URL string to be rendered as a QR image (not an image itself). */
  qrcodeContent: string
}

export type IlinkQrStatus = 'wait' | 'scaned' | 'expired' | 'confirmed'

export interface IlinkQrStatusResp {
  status: IlinkQrStatus
  bot_token?: string
  baseurl?: string
  ilink_bot_id?: string
  ilink_user_id?: string
}

export interface IlinkCdnMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
  full_url?: string
}

export interface IlinkImageItem {
  aeskey?: string
  media?: IlinkCdnMedia
  mid_size?: number
  thumb_size?: number
  hd_size?: number
}
export interface IlinkVoiceItem {
  aeskey?: string
  media?: IlinkCdnMedia
  encode_type?: number
  bits_per_sample?: number
  sample_rate?: number
  playtime?: number
  text?: string
}
export interface IlinkFileItem {
  aeskey?: string
  media?: IlinkCdnMedia
  file_name?: string
  len?: string | number
}
export interface IlinkVideoItem {
  aeskey?: string
  media?: IlinkCdnMedia
  video_size?: number
  play_length?: number
  video_md5?: string
}

export interface IlinkMessageItem {
  type: number
  text_item?: { text?: string }
  image_item?: IlinkImageItem
  voice_item?: IlinkVoiceItem
  file_item?: IlinkFileItem
  video_item?: IlinkVideoItem
}

export interface IlinkMessage {
  from_user_id?: string
  to_user_id?: string
  message_type?: number
  message_id?: string | number
  msg_id?: string | number
  client_id?: string
  context_token?: string
  create_time?: number
  create_time_ms?: number
  item_list?: IlinkMessageItem[]
}

export interface IlinkUpdates {
  ret?: number
  errmsg?: string
  msgs?: IlinkMessage[]
  get_updates_buf?: string
}

export interface IlinkConfigResp {
  ret?: number
  errmsg?: string
  typing_ticket?: string
}

export interface IlinkUploadUrlResp {
  ret?: number
  errmsg?: string
  upload_param?: string
  thumb_upload_param?: string
  upload_full_url?: string
}

export interface IlinkAttachment {
  kind: 'image' | 'file' | 'video' | 'voice'
  filename: string
  mediaType: string
  sizeBytes?: number
  url?: string
  aesKey?: string
}

export interface ParsedIncoming {
  textSegments: string[]
  attachments: IlinkAttachment[]
  /** Voice transcript supplied by the server, when any. */
  voiceTranscript?: string
}

export function isSessionExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('session timeout') || msg.includes('-14')
}

/** iLink-App-ClientVersion: uint32 = major<<16 | minor<<8 | patch. */
export function buildClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((p) => parseInt(p, 10) || 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/&amp;/g, '&')
}

export function guessMediaTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf('.') + 1)
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    mp4: 'video/mp4',
    silk: 'audio/silk',
    amr: 'audio/amr',
    mp3: 'audio/mpeg',
  }
  return table[ext] ?? 'application/octet-stream'
}

/** Split an inbound item_list into text segments and downloadable attachments. */
export function parseIncomingMessage(msg: IlinkMessage): ParsedIncoming {
  const textSegments: string[] = []
  const attachments: IlinkAttachment[] = []
  let voiceTranscript: string | undefined

  ;(msg.item_list ?? []).forEach((item, index) => {
    switch (item.type) {
      case MessageItemType.TEXT: {
        const text = str(item.text_item?.text)
        if (text) textSegments.push(text)
        return
      }
      case MessageItemType.VOICE: {
        const voice = item.voice_item
        const transcript = str(voice?.text)
        if (transcript) voiceTranscript = transcript
        const url = normalizeUrl(str(voice?.media?.full_url))
        attachments.push({
          kind: 'voice',
          filename: `wechat-voice-${index + 1}.silk`,
          mediaType: 'audio/silk',
          url: url || undefined,
          aesKey: str(voice?.aeskey) || str(voice?.media?.aes_key) || undefined,
        })
        return
      }
      case MessageItemType.IMAGE: {
        const image = item.image_item
        attachments.push({
          kind: 'image',
          filename: `wechat-image-${index + 1}.jpg`,
          mediaType: 'image/jpeg',
          sizeBytes: num(image?.hd_size) ?? num(image?.mid_size) ?? num(image?.thumb_size),
          url: normalizeUrl(str(image?.media?.full_url)) || undefined,
          aesKey: str(image?.aeskey) || str(image?.media?.aes_key) || undefined,
        })
        return
      }
      case MessageItemType.FILE: {
        const file = item.file_item
        const filename = str(file?.file_name) || `wechat-file-${index + 1}`
        attachments.push({
          kind: 'file',
          filename,
          mediaType: guessMediaTypeFromFilename(filename),
          sizeBytes: num(file?.len),
          url: normalizeUrl(str(file?.media?.full_url)) || undefined,
          aesKey: str(file?.aeskey) || str(file?.media?.aes_key) || undefined,
        })
        return
      }
      case MessageItemType.VIDEO: {
        const video = item.video_item
        attachments.push({
          kind: 'video',
          filename: `wechat-video-${index + 1}.mp4`,
          mediaType: 'video/mp4',
          sizeBytes: num(video?.video_size),
          url: normalizeUrl(str(video?.media?.full_url)) || undefined,
          aesKey: str(video?.aeskey) || str(video?.media?.aes_key) || undefined,
        })
        return
      }
      default:
        return
    }
  })

  return { textSegments, attachments, voiceTranscript }
}

/** Readable one-line text for a parsed message (placeholders for media, transcript for voice). */
export function incomingText(parsed: ParsedIncoming): string {
  const parts = [...parsed.textSegments]
  for (const a of parsed.attachments) {
    if (a.kind === 'voice') parts.push(parsed.voiceTranscript ? `[语音] ${parsed.voiceTranscript}` : '[语音]')
    else if (a.kind === 'image') parts.push('[图片]')
    else if (a.kind === 'video') parts.push('[视频]')
    else parts.push(`[文件] ${a.filename}`)
  }
  return parts.join('\n').trim()
}

/** Dominant inbound kind: text wins when any text is present, else the first attachment's kind. */
export function incomingKind(parsed: ParsedIncoming): InboundKind {
  if (parsed.textSegments.length > 0) return 'text'
  const first = parsed.attachments[0]
  if (!first) return 'text'
  return first.kind
}

/**
 * Stable key for de-duplication across long-poll retries. Prefer server ids; otherwise hash the
 * sender + context token + content so a redelivered update collapses to one event.
 */
export function messageKey(msg: IlinkMessage): string {
  const explicit = msg.message_id ?? msg.msg_id ?? msg.client_id
  if (explicit !== undefined && explicit !== '') return `id:${String(explicit)}`
  const h = createHash('sha1')
  h.update(msg.from_user_id ?? '')
  h.update('|')
  h.update(msg.context_token ?? '')
  h.update('|')
  h.update(String(msg.create_time_ms ?? msg.create_time ?? ''))
  h.update('|')
  h.update(JSON.stringify(msg.item_list ?? []))
  return `h:${h.digest('hex').slice(0, 24)}`
}

/** Millisecond timestamp for an inbound message, tolerating seconds and missing fields. */
export function messageTimestamp(msg: IlinkMessage, fallback: number): number {
  if (typeof msg.create_time_ms === 'number' && msg.create_time_ms > 0) return msg.create_time_ms
  if (typeof msg.create_time === 'number' && msg.create_time > 0) return msg.create_time < 1e12 ? msg.create_time * 1000 : msg.create_time
  return fallback
}
