/**
 * Message table row → protocol WxMessage. Pure: every DB-dependent input (self row id, name lookup)
 * is passed in through MessageRowContext so the mapping is unit-testable.
 */
import type { MessageKind, WxMedia, WxMessage } from '@aiwc/protocol'
import { parseRichContent, isPatMessage, patText } from './richContent'
import { buildIdentityKeys, identityMatches } from './accountUtils'
import {
  APP_TYPE,
  LOCAL_TYPE,
  isRevokeContent,
  parseFileInfo,
  parseImageInfo,
  parseMessageContent,
  parseQuoteMessage,
  parseVideoDuration,
  parseVideoMd5,
  parseVoiceDurationMs,
} from './contentParsers'
import {
  coerceRowNumber,
  coerceRowString,
  decodeMessageContent,
  extractXmlValue,
  getRowField,
  type Row,
} from './rowDecoders'

const TWO_POW_32 = 4_294_967_296

const TYPE_FIELDS = [
  'local_type', 'localType', 'type', 'Type', 'msg_type', 'msgType', 'MsgType', 'message_type', 'messageType', 'WCDB_CT_local_type',
]
const CONTENT_FIELDS = ['message_content', 'messageContent', 'content', 'Content', 'raw_content', 'rawContent']
const COMPRESS_FIELDS = ['compress_content', 'compressContent', 'compressedContent', 'CompressContent']
const SENDER_FIELDS = ['sender_username', 'senderUsername', 'sender', 'talker', 'src']
const LOCAL_ID_FIELDS = ['local_id', 'localId', 'id', 'ID']
const SERVER_ID_FIELDS = ['server_id', 'serverId', 'MsgSvrID', 'msgSvrId', 'msg_svr_id']
const CREATE_TIME_FIELDS = ['create_time', 'createTime', 'CreateTime']
const SORT_SEQ_FIELDS = ['sort_seq', 'sortSeq', 'sequence', 'Sequence']

export interface MessageRowContext {
  sessionId: string
  isGroup: boolean
  /** Account directory name / wxid used as senderId for own messages. */
  selfWxid: string
  /** Name2Id rowid of self in the shard the row came from (enables computed_is_send). */
  myRowId?: number | null
  /** Display name lookup for sender usernames (contact / group member names). */
  resolveName?: (username: string) => string | undefined
}

/** `local_type` in WeChat 4.x packs a sub type in the high 32 bits: 244813135921 = 57<<32 | 49. */
export function splitLocalType(localType: number): { base: number; sub: number } {
  if (!Number.isFinite(localType) || localType < 0) return { base: 0, sub: 0 }
  if (localType < TWO_POW_32) return { base: localType, sub: 0 }
  const sub = Math.floor(localType / TWO_POW_32)
  return { base: localType - sub * TWO_POW_32, sub }
}

/** Tolerant `local_type` read (different column names / string values across versions). */
export function resolveLocalType(row: Row, fallback = 1): number {
  let zeroCandidate: number | undefined
  for (const field of TYPE_FIELDS) {
    const value = getRowField(row, [field])
    if (value === null || value === undefined || value === '') continue
    const parsed = coerceRowNumber(value, Number.NaN)
    if (!Number.isFinite(parsed)) continue
    if (parsed > 0) return parsed
    if (parsed === 0 && zeroCandidate === undefined) zeroCandidate = 0
  }
  return zeroCandidate ?? fallback
}

/** Sort key: `sort_seq` when present, otherwise `create_time*1000 + local_id`. */
export function deriveSeq(sortSeq: number, createTime: number, localId: number): number {
  if (Number.isFinite(sortSeq) && sortSeq > 0) return sortSeq
  return Math.max(0, Math.floor(createTime)) * 1000 + Math.max(0, Math.floor(localId))
}

/** SQL expression equivalent to deriveSeq (kept next to it so both stay in sync). */
export const SEQ_SQL_EXPR = 'CASE WHEN sort_seq > 0 THEN sort_seq ELSE create_time * 1000 + local_id END'

function looksLikeXml(content: string): boolean {
  const trimmed = content.trimStart()
  return trimmed.startsWith('<') && trimmed.includes('>')
}

export function classifyKind(baseType: number, content: string): { kind: MessageKind; xmlType: string } {
  const xmlType = content ? extractXmlValue(content, 'type') : ''
  if (isPatMessage(content)) return { kind: 'system', xmlType }
  switch (baseType) {
    case LOCAL_TYPE.TEXT:
      return { kind: 'text', xmlType }
    case LOCAL_TYPE.IMAGE:
      return { kind: 'image', xmlType }
    case LOCAL_TYPE.VOICE:
      return { kind: 'voice', xmlType }
    case LOCAL_TYPE.CARD:
      return { kind: 'card', xmlType }
    case LOCAL_TYPE.VIDEO:
      return { kind: 'video', xmlType }
    case LOCAL_TYPE.STICKER:
      return { kind: 'sticker', xmlType }
    case LOCAL_TYPE.LOCATION:
      return { kind: 'location', xmlType }
    case LOCAL_TYPE.APP:
      return { kind: classifyAppKind(xmlType), xmlType }
    case LOCAL_TYPE.VOIP:
      return { kind: 'other', xmlType }
    case LOCAL_TYPE.SYSTEM:
    case LOCAL_TYPE.SYSTEM_XML:
      return { kind: isRevokeContent(content) ? 'revoke' : 'system', xmlType }
    default: {
      if (xmlType) return { kind: classifyAppKind(xmlType), xmlType }
      if (content && !looksLikeXml(content) && content.length <= 2000) return { kind: 'text', xmlType }
      if (isRevokeContent(content)) return { kind: 'revoke', xmlType }
      return { kind: 'other', xmlType }
    }
  }
}

function classifyAppKind(xmlType: string): MessageKind {
  switch (xmlType) {
    case APP_TYPE.FILE:
      return 'file'
    case APP_TYPE.QUOTE:
      return 'quote'
    case APP_TYPE.TRANSFER:
    case APP_TYPE.RED_PACKET:
      return 'transfer'
    case APP_TYPE.ANNOUNCEMENT:
      return 'link'
    case '':
      return 'other'
    default:
      return 'link'
  }
}

/** Determine whether the row was sent by the account owner. */
export function resolveIsSelf(row: Row, senderUsername: string | undefined, ctx: MessageRowContext): boolean {
  const rawIsSend = getRowField(row, ['is_send', 'isSend', 'is_sender', 'isSender', 'WCDB_CT_is_send'])
  const computed = getRowField(row, ['computed_is_send', 'computedIsSend'])
  if (coerceRowNumber(rawIsSend, -1) === 1 || coerceRowNumber(computed, -1) === 1) return true
  if (ctx.myRowId !== undefined && ctx.myRowId !== null) {
    const realSender = coerceRowNumber(getRowField(row, ['real_sender_id', 'realSenderId']), Number.NaN)
    if (Number.isFinite(realSender) && realSender === ctx.myRowId) return true
  }
  if (senderUsername) {
    const senderKeys = buildIdentityKeys(senderUsername)
    const selfKeys = buildIdentityKeys(ctx.selfWxid)
    if (senderKeys.length && selfKeys.length && identityMatches(senderKeys, selfKeys)) return true
  }
  return coerceRowNumber(rawIsSend, 0) === 1
}

/** Raw fields we need again when resolving media lazily. */
export interface MessageRawInfo {
  localId: number
  serverId: number
  localType: number
  baseType: number
  createTime: number
  sortSeq: number
  content: string
}

export function readRawInfo(row: Row): MessageRawInfo {
  const content = decodeMessageContent(getRowField(row, CONTENT_FIELDS), getRowField(row, COMPRESS_FIELDS))
  const localType = resolveLocalType(row, 1)
  return {
    localId: coerceRowNumber(getRowField(row, LOCAL_ID_FIELDS), 0),
    serverId: coerceRowNumber(getRowField(row, SERVER_ID_FIELDS), 0),
    localType,
    baseType: splitLocalType(localType).base,
    createTime: coerceRowNumber(getRowField(row, CREATE_TIME_FIELDS), 0),
    sortSeq: coerceRowNumber(getRowField(row, SORT_SEQ_FIELDS), 0),
    content,
  }
}

function buildMedia(kind: MessageKind, content: string): WxMedia | undefined {
  switch (kind) {
    case 'image':
      return { kind: 'image' }
    case 'sticker':
      return { kind: 'sticker' }
    case 'voice': {
      const durationMs = parseVoiceDurationMs(content)
      return durationMs ? { kind: 'voice', durationMs } : { kind: 'voice' }
    }
    case 'video': {
      const seconds = parseVideoDuration(content)
      return { kind: 'video', durationMs: seconds ? seconds * 1000 : undefined }
    }
    case 'file': {
      const info = parseFileInfo(content)
      return { kind: 'file', fileName: info.fileName, sizeBytes: info.fileSize }
    }
    default:
      return undefined
  }
}

/** Stable identity used to de-duplicate rows that appear in several shards. */
export function messageIdentityKey(raw: Pick<MessageRawInfo, 'serverId' | 'localId' | 'createTime' | 'sortSeq'>): string {
  return `${raw.serverId}-${raw.localId}-${raw.createTime}-${raw.sortSeq}`
}

export function rowToWxMessage(row: Row, ctx: MessageRowContext): WxMessage {
  const raw = readRawInfo(row)
  const senderUsername = coerceRowString(getRowField(row, SENDER_FIELDS))
  const isSelf = resolveIsSelf(row, senderUsername, ctx)
  const rich = parseRichContent(raw.content, raw.baseType)
  const classified = classifyKind(raw.baseType, raw.content)
  const kind = rich?.type === 'article' ? 'link' : classified.kind
  const text = isPatMessage(raw.content) ? patText(raw.content) : rich?.type === 'article' ? rich.title : parseMessageContent(raw.content, raw.baseType)
  const seq = deriveSeq(raw.sortSeq, raw.createTime, raw.localId)
  const createdAt = raw.createTime * 1000
  // local_id restarts in each shard; it is not a session-wide identity.
  const id = `wx:${raw.localId}:${seq}`

  const senderId = isSelf ? ctx.selfWxid : senderUsername || (ctx.isGroup ? '' : ctx.sessionId)
  const senderName = senderId ? ctx.resolveName?.(senderId) : undefined

  const message: WxMessage = {
    id,
    sessionId: ctx.sessionId,
    seq,
    createdAt,
    senderId,
    senderName,
    isSelf,
    kind,
    text,
    rich,
    presentationVersion: 1,
    anchor: { sessionId: ctx.sessionId, messageId: id, seq, createdAt },
  }
  const media = buildMedia(kind, raw.content)
  if (media) message.media = media
  if (kind === 'quote') {
    const quote = parseQuoteMessage(raw.content)
    if (quote.content) message.quote = { senderName: quote.sender, text: quote.content }
  }
  return message
}

/** Media identifiers extracted from the raw body (used by resolveMedia). */
export interface MediaLocator {
  kind: WxMedia['kind']
  imageMd5?: string
  imageDatName?: string
  videoMd5?: string
  fileName?: string
  fileMd5?: string
  fileSize?: number
  durationMs?: number
}

export function extractMediaLocator(row: Row, raw: MessageRawInfo): MediaLocator | undefined {
  const { kind } = classifyKind(raw.baseType, raw.content)
  switch (kind) {
    case 'image': {
      const info = parseImageInfo(raw.content)
      return { kind: 'image', imageMd5: info.md5, imageDatName: undefined }
    }
    case 'voice':
      return { kind: 'voice', durationMs: parseVoiceDurationMs(raw.content) }
    case 'video': {
      const seconds = parseVideoDuration(raw.content)
      return { kind: 'video', videoMd5: parseVideoMd5(raw.content), durationMs: seconds ? seconds * 1000 : undefined }
    }
    case 'file': {
      const info = parseFileInfo(raw.content)
      return { kind: 'file', fileName: info.fileName, fileMd5: info.fileMd5, fileSize: info.fileSize }
    }
    case 'sticker':
      return { kind: 'sticker' }
    default:
      return undefined
  }
}
