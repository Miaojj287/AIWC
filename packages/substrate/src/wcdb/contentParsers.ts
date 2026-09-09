/**
 * Parsers for WeChat message bodies (mostly XML). They turn raw `message_content` into the
 * human-readable text shown in the UI and pull out media descriptors (md5 / file names / durations).
 * Pure functions, unit-tested with XML fixtures.
 */
import {
  cleanString,
  cleanSystemMessage,
  decodeBlob,
  decodeHtmlEntities,
  extractXmlAttribute,
  extractXmlValue,
  getRowField,
  looksLikeWxid,
  stripSenderPrefix,
  type Row,
} from './rowDecoders'

/** Message type constants (low 32 bits of `local_type`). */
export const LOCAL_TYPE = {
  TEXT: 1,
  IMAGE: 3,
  VOICE: 34,
  CARD: 42,
  VIDEO: 43,
  STICKER: 47,
  LOCATION: 48,
  APP: 49,
  VOIP: 50,
  SYSTEM: 10000,
  SYSTEM_XML: 10002,
} as const

/** `<type>` inside an appmsg (local_type 49). */
export const APP_TYPE = {
  MUSIC: '3',
  LINK: '5',
  FILE: '6',
  CHAT_HISTORY: '19',
  MINI_PROGRAM: '33',
  MINI_PROGRAM_2: '36',
  URL: '49',
  QUOTE: '57',
  ANNOUNCEMENT: '87',
  GIFT: '115',
  TRANSFER: '2000',
  RED_PACKET: '2001',
} as const

export function getMessageTypeLabel(localType: number): string {
  const labels: Record<number, string> = {
    1: '[文本]',
    3: '[图片]',
    34: '[语音]',
    42: '[名片]',
    43: '[视频]',
    47: '[表情]',
    48: '[位置]',
    49: '[链接]',
    50: '[通话]',
    10000: '[系统消息]',
  }
  return labels[localType] ?? '[消息]'
}

export function parseVoipMessage(content: string): string {
  return extractXmlValue(content, 'msg') || '通话'
}

/**
 * appmsg (type 49) → display text. `rawContent` must be the un-decoded body: inner pasted XML is still
 * entity-escaped there so the non-greedy `<title>` regex cannot be hijacked by nested tags.
 */
export function parseType49(content: string, rawContent: string = content): string {
  const title = decodeHtmlEntities(extractXmlValue(rawContent, 'title'))
  const type = extractXmlValue(rawContent, 'type')

  if (type === APP_TYPE.ANNOUNCEMENT) {
    const text = extractXmlValue(content, 'textannouncement')
    return text ? `[群公告] ${text}` : '[群公告]'
  }
  if (type === APP_TYPE.TRANSFER) {
    const feedesc = extractXmlValue(content, 'feedesc')
    const payMemo = extractXmlValue(content, 'pay_memo')
    if (feedesc) return payMemo ? `[转账] ${feedesc} ${payMemo}` : `[转账] ${feedesc}`
    return '[转账]'
  }
  if (type === APP_TYPE.RED_PACKET) {
    const greeting = extractXmlValue(content, 'receivertitle') || extractXmlValue(content, 'sendertitle')
    return greeting ? `[红包] ${greeting}` : '[红包]'
  }
  if (type === APP_TYPE.GIFT) {
    const wish = extractXmlValue(content, 'wishmessage') || '送你一份心意'
    const sku = extractXmlValue(content, 'skutitle')
    return sku ? `[微信礼物] ${wish} - ${sku}` : `[微信礼物] ${wish}`
  }
  if (type === APP_TYPE.MUSIC) {
    const des = extractXmlValue(content, 'des')
    return title ? `[音乐] ${title}${des ? ` - ${des}` : ''}` : '[音乐]'
  }
  if (title) {
    switch (type) {
      case APP_TYPE.LINK:
      case APP_TYPE.URL:
        return `[链接] ${title}`
      case APP_TYPE.FILE:
        return `[文件] ${title}`
      case APP_TYPE.CHAT_HISTORY:
        return `[聊天记录] ${title}`
      case APP_TYPE.MINI_PROGRAM:
      case APP_TYPE.MINI_PROGRAM_2:
        return `[小程序] ${title}`
      default:
        return title
    }
  }
  return '[消息]'
}

const TYPE49_LIKE = new Set<string>([
  APP_TYPE.TRANSFER, APP_TYPE.RED_PACKET, APP_TYPE.LINK, APP_TYPE.FILE, APP_TYPE.CHAT_HISTORY,
  APP_TYPE.MINI_PROGRAM, APP_TYPE.MINI_PROGRAM_2, APP_TYPE.URL, APP_TYPE.QUOTE, APP_TYPE.MUSIC, APP_TYPE.GIFT,
])

/** Human-readable text for any message. `localType` is the base type (see splitLocalType). */
export function parseMessageContent(rawInput: string, localType: number): string {
  if (!rawInput) return getMessageTypeLabel(localType)
  const rawContent = rawInput
  const content = decodeHtmlEntities(rawInput)
  const xmlType = extractXmlValue(rawContent, 'type')

  switch (localType) {
    case LOCAL_TYPE.TEXT:
      return stripSenderPrefix(content)
    case LOCAL_TYPE.IMAGE:
      return '[图片]'
    case LOCAL_TYPE.VOICE:
      return '[语音消息]'
    case LOCAL_TYPE.CARD: {
      const nickname = /nickname="([^"]*)"/.exec(content)?.[1]
      return nickname ? `[名片] ${nickname}` : '[名片]'
    }
    case LOCAL_TYPE.VIDEO:
      return '[视频]'
    case LOCAL_TYPE.STICKER:
      return '[动画表情]'
    case LOCAL_TYPE.LOCATION: {
      const poiname = /poiname="([^"]*)"/.exec(content)?.[1]
      const label = /label="([^"]*)"/.exec(content)?.[1]
      return poiname ? `[位置] ${poiname}` : label ? `[位置] ${label}` : '[位置]'
    }
    case LOCAL_TYPE.APP:
      return parseType49(content, rawContent)
    case LOCAL_TYPE.VOIP:
      return parseVoipMessage(content)
    case LOCAL_TYPE.SYSTEM:
    case LOCAL_TYPE.SYSTEM_XML:
      return cleanSystemMessage(content)
    default:
      if (xmlType) {
        if (xmlType === APP_TYPE.ANNOUNCEMENT) {
          const text = extractXmlValue(content, 'textannouncement')
          return text ? `[群公告] ${text}` : '[群公告]'
        }
        if (TYPE49_LIKE.has(xmlType)) return parseType49(content, rawContent)
      }
      if (content.length > 200) return getMessageTypeLabel(localType)
      return stripSenderPrefix(content) || getMessageTypeLabel(localType)
  }
}

export interface EmojiInfo {
  cdnUrl?: string
  md5?: string
  productId?: string
}

export function parseEmojiInfo(content: string): EmojiInfo {
  const pickUrl = (attr: string): string | undefined => {
    const match = new RegExp(`${attr}\\s*=\\s*['"]([^'"]+)['"]`, 'i').exec(content)
    if (!match?.[1]) return undefined
    let url = match[1].replace(/&amp;/g, '&')
    if (/^https?%3a/i.test(url)) {
      try { url = decodeURIComponent(url) } catch { /* keep encoded */ }
    }
    return url
  }
  const cdnUrl = pickUrl('cdnurl') ?? pickUrl('thumburl')
  const md5Match = /md5\s*=\s*['"]([a-fA-F0-9]+)['"]/i.exec(content) || /<md5>([^<]+)<\/md5>/i.exec(content)
  const idMatch = /productid\s*=\s*['"]([^'"]+)['"]/i.exec(content)
  return { cdnUrl, md5: md5Match?.[1]?.toLowerCase(), productId: idMatch?.[1] }
}

export interface ImageInfo {
  md5?: string
  aesKey?: string
  isLivePhoto?: boolean
}

export function parseImageInfo(content: string): ImageInfo {
  const isLivePhoto = /<live>/i.test(content)
  const noLive = content.replace(/<live>[\s\S]*?<\/live>/gi, '')
  const md5 =
    extractXmlValue(noLive, 'md5') ||
    extractXmlAttribute(noLive, 'img', 'md5') ||
    extractXmlAttribute(noLive, 'img', 'cdnthumbmd5') ||
    extractXmlAttribute(noLive, 'img', 'thumbfullmd5') ||
    extractXmlAttribute(noLive, 'img', 'fullmd5') ||
    undefined
  const aesKey = extractXmlAttribute(content, 'img', 'aeskey') || undefined
  return { md5: md5?.toLowerCase(), aesKey, isLivePhoto: isLivePhoto || undefined }
}

/** Video play length in seconds. */
export function parseVideoDuration(content: string): number | undefined {
  const match = /playlength\s*=\s*['"](\d+)['"]/i.exec(content)
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined
}

export function parseVideoMd5(content: string): string | undefined {
  if (!content) return undefined
  const md5 =
    extractXmlValue(content, 'md5') ||
    extractXmlAttribute(content, 'videomsg', 'md5') ||
    extractXmlValue(content, 'newmd5') ||
    extractXmlAttribute(content, 'videomsg', 'newmd5') ||
    extractXmlValue(content, 'rawmd5') ||
    extractXmlAttribute(content, 'videomsg', 'rawmd5') ||
    undefined
  const result = md5?.toLowerCase()
  return result && /^[a-f0-9]{32}$/.test(result) ? result : undefined
}

/** Video file size in bytes (`length` attribute), used to match hardlink rows without md5. */
export function parseVideoLength(content: string): number | undefined {
  const match = /\slength\s*=\s*['"](\d+)['"]/i.exec(content)
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined
}

export interface FileInfo {
  fileName?: string
  fileSize?: number
  fileExt?: string
  fileMd5?: string
}

export function parseFileInfo(content: string): FileInfo {
  if (!content) return {}
  if (extractXmlValue(content, 'type') !== APP_TYPE.FILE) return {}
  const fileName = decodeHtmlEntities(extractXmlValue(content, 'title')) || undefined
  const totallen = extractXmlValue(content, 'totallen')
  const fileSize = totallen ? Number.parseInt(totallen, 10) : undefined
  const fileExt = extractXmlValue(content, 'fileext') || undefined
  const fileMd5 = extractXmlValue(content, 'md5')?.toLowerCase() || undefined
  return { fileName, fileSize: Number.isFinite(fileSize) ? fileSize : undefined, fileExt, fileMd5 }
}

/** Link/mini-program metadata for `link` messages. */
export function parseLinkInfo(content: string): { title?: string; url?: string; description?: string } {
  const title = decodeHtmlEntities(extractXmlValue(content, 'title')) || undefined
  const url = decodeHtmlEntities(extractXmlValue(content, 'url')) || undefined
  const description = decodeHtmlEntities(extractXmlValue(content, 'des')) || undefined
  return { title, url, description }
}

const PACKED_INFO_FIELDS = [
  'packed_info_data', 'packed_info', 'packedInfoData', 'packedInfo', 'PackedInfoData', 'PackedInfo',
  'packed_info_blob', 'packedInfoBlob', 'BytesExtra', 'bytes_extra', 'reserved0', 'Reserved0',
  'WCDB_CT_packed_info_data', 'WCDB_CT_packed_info', 'WCDB_CT_PackedInfoData', 'WCDB_CT_PackedInfo', 'WCDB_CT_Reserved0',
]

/** Extract the image `.dat` base name hidden in `packed_info_data`. */
export function parseImageDatNameFromRow(row: Row): string | undefined {
  const buffer = decodeBlob(getRowField(row, PACKED_INFO_FIELDS))
  if (!buffer || buffer.length === 0) return undefined
  const printable = Buffer.alloc(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i] ?? 0
    printable[i] = byte >= 0x20 && byte <= 0x7e ? byte : 0x20
  }
  const text = printable.toString('latin1')
  const match = /([0-9a-fA-F]{8,})(?:\.t)?\.dat/.exec(text)
  if (match?.[1]) return match[1].toLowerCase()
  return /([0-9a-fA-F]{16,})/.exec(text)?.[1]?.toLowerCase()
}

export function sanitizeQuotedContent(content: string): string {
  if (!content) return ''
  return content
    .replace(/wxid_[A-Za-z0-9_-]{3,}/g, '')
    .replace(/^[\s:：-]+/, '')
    .replace(/[:：]{2,}/g, ':')
    .replace(/^[\s:：-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface QuoteInfo {
  content?: string
  sender?: string
  imageMd5?: string
  emojiMd5?: string
  emojiCdnUrl?: string
}

/** `<refermsg>` of a quote reply (type 57). */
export function parseQuoteMessage(content: string): QuoteInfo {
  const start = content.indexOf('<refermsg>')
  const end = content.indexOf('</refermsg>')
  if (start === -1 || end === -1) return {}
  const referXml = content.substring(start, end + '</refermsg>'.length)

  let displayName = extractXmlValue(referXml, 'displayname')
  if (displayName && looksLikeWxid(displayName)) displayName = ''
  const referContent = decodeHtmlEntities(extractXmlValue(referXml, 'content'))
  const referType = extractXmlValue(referXml, 'type')

  let display = referContent
  let imageMd5: string | undefined
  switch (referType) {
    case '1':
      display = sanitizeQuotedContent(referContent)
      break
    case '3': {
      display = '[图片]'
      imageMd5 = extractXmlValue(referContent, 'md5') || /\bmd5="([a-f0-9]+)"/i.exec(referContent)?.[1] || undefined
      break
    }
    case '34':
      display = '[语音]'
      break
    case '43':
      display = '[视频]'
      break
    case '47': {
      const emoji = parseEmojiInfo(referContent)
      return { content: '[动画表情]', sender: displayName || undefined, emojiMd5: emoji.md5, emojiCdnUrl: emoji.cdnUrl }
    }
    case '49':
      display = decodeHtmlEntities(extractXmlValue(referContent, 'title')) || '[链接]'
      break
    case '42':
      display = '[名片]'
      break
    case '48':
      display = '[位置]'
      break
    default:
      display = !referContent || referContent.includes('wxid_') ? '[消息]' : sanitizeQuotedContent(referContent)
  }
  return { content: display, sender: displayName || undefined, imageMd5 }
}

/** Session list preview: fall back to a type label when the stored summary is empty. */
export function processSummary(summary: unknown, lastMsgType: number): string {
  const cleaned = cleanString(summary)
  if (cleaned.trim()) return cleaned
  return getMessageTypeLabel(lastMsgType)
}

/** Voice duration in milliseconds. */
export function parseVoiceDurationMs(content: string): number | undefined {
  if (!content) return undefined
  const match = /(voicelength|length|time|playlength)\s*=\s*['"]?([0-9]+(?:\.[0-9]+)?)['"]?/i.exec(content)
  if (!match?.[2]) return undefined
  const ms = Number.parseFloat(match[2])
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined
}

/** Transfer payer/receiver wxids (type 2000). */
export function parseTransferParties(content: string): { payer?: string; receiver?: string } {
  return {
    payer: extractXmlValue(content, 'payer_username') || undefined,
    receiver: extractXmlValue(content, 'receiver_username') || undefined,
  }
}

/** Revoke notices come as `<revokemsg>` sysmsg or plain "撤回了一条消息" text. */
export function isRevokeContent(content: string): boolean {
  return /<revokemsg>/i.test(content) || /撤回了一条消息/.test(content)
}
