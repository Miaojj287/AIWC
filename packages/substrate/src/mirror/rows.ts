import type { MessageKind, SessionKind, WxContact, WxMedia, WxMessage, WxSession } from '@aiwc/protocol'
import { num, str } from './db'

export interface SessionRow {
  id: string
  kind: string
  title: string
  avatar_path: string | null
  last_message_at: number | null
  last_preview: string | null
  last_sender: string | null
  unread: number
  member_count: number | null
  indexed_count: number
  indexed_until: number | null
  watermark_seq: number
  pinned: number
  collapsed: number
  muted: number
  pinned_local: number | null
  muted_local: number | null
  hidden: number
  hidden_at: number | null
}

export interface MessageRow {
  id: number
  session_id: string
  msg_id: string
  seq: number
  created_at: number
  sender_id: string
  sender_name: string | null
  is_self: number
  kind: string
  text: string
  media_json: string | null
  quote_json: string | null
  presentation_json?: string | null
}

export interface ContactRow {
  username: string
  nickname: string
  remark: string | null
  alias: string | null
  avatar_path: string | null
  kind: string
  last_contact_at: number | null
}

function parseJson<T>(s: string | null | undefined): T | undefined {
  if (!s) return undefined
  try {
    return JSON.parse(s) as T
  } catch {
    return undefined
  }
}

export function rowToSession(r: SessionRow): WxSession {
  const s: WxSession = {
    id: r.id,
    kind: r.kind as SessionKind,
    title: r.title || r.id,
    unread: num(r.unread),
    pinned: num(r.pinned_local ?? r.pinned) === 1,
    muted: num(r.muted_local ?? r.muted) === 1,
    indexedCount: num(r.indexed_count),
    collapsed: num(r.collapsed) === 1,
  }
  if (r.avatar_path) s.avatarPath = r.avatar_path
  if (r.last_message_at) s.lastMessageAt = num(r.last_message_at)
  if (r.last_preview) s.lastPreview = r.last_preview
  if (r.last_sender) s.lastSender = r.last_sender
  if (r.member_count !== null && r.member_count !== undefined) s.memberCount = num(r.member_count)
  if (r.indexed_until) s.indexedUntil = num(r.indexed_until)
  return s
}

export function rowToMessage(r: MessageRow): WxMessage {
  const m: WxMessage = {
    id: r.msg_id,
    sessionId: r.session_id,
    seq: num(r.seq),
    createdAt: num(r.created_at),
    senderId: r.sender_id ?? '',
    isSelf: num(r.is_self) === 1,
    kind: r.kind as MessageKind,
    text: r.text ?? '',
    anchor: { sessionId: r.session_id, messageId: r.msg_id, seq: num(r.seq), createdAt: num(r.created_at) },
  }
  const presentation = parseJson<Pick<WxMessage, 'rich' | 'presentationVersion'>>(r.presentation_json)
  if (presentation) Object.assign(m, presentation)
  const senderName = str(r.sender_name)
  if (senderName) m.senderName = senderName
  const media = parseJson<WxMedia>(r.media_json)
  if (media) m.media = media
  const quote = parseJson<{ senderName?: string; text: string }>(r.quote_json)
  if (quote) m.quote = quote
  return m
}

export function rowToContact(r: ContactRow): WxContact {
  const c: WxContact = {
    username: r.username,
    nickname: r.nickname || r.username,
    kind: r.kind as WxContact['kind'],
  }
  if (r.remark) c.remark = r.remark
  if (r.alias) c.alias = r.alias
  if (r.avatar_path) c.avatarPath = r.avatar_path
  if (r.last_contact_at) c.lastContactAt = num(r.last_contact_at)
  return c
}
