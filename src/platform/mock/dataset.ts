/**
 * In-memory index over the demo fixture. Timestamps are rebased so the newest message is a few
 * minutes before "now" — the dataset always looks fresh regardless of when it was generated.
 */
import type { WxAccount, WxContact, WxMessage, WxSession } from '@aiwc/protocol'
import type { DemoFixture } from './types'

export interface DatasetIndex {
  account: WxAccount
  selfContact: WxContact
  sessions: Map<string, WxSession>
  /** ascending by seq */
  messagesBySession: Map<string, WxMessage[]>
  messageById: Map<string, WxMessage>
  contacts: Map<string, WxContact>
  contactList: WxContact[]
  groupMembers: Record<string, string[]>
  /** time span of the (rebased) data */
  range: { from: number; to: number }
}

const FRESHNESS_MS = 3 * 60_000

export function indexFixture(fixture: DemoFixture, now: number): DatasetIndex {
  let max = 0
  let min = Number.POSITIVE_INFINITY
  for (const m of fixture.messages) {
    if (m.createdAt > max) max = m.createdAt
    if (m.createdAt < min) min = m.createdAt
  }
  const shift = fixture.messages.length ? now - FRESHNESS_MS - max : 0
  const t = (ms: number | undefined) => (ms === undefined ? undefined : ms + shift)

  const sessions = new Map<string, WxSession>()
  for (const s of fixture.sessions) {
    const copy: WxSession = { ...s }
    if (s.lastMessageAt !== undefined) copy.lastMessageAt = t(s.lastMessageAt)
    if (s.indexedUntil !== undefined) copy.indexedUntil = t(s.indexedUntil)
    sessions.set(s.id, copy)
  }

  const messagesBySession = new Map<string, WxMessage[]>()
  const messageById = new Map<string, WxMessage>()
  for (const m of fixture.messages) {
    const createdAt = m.createdAt + shift
    const copy: WxMessage = {
      ...m,
      createdAt,
      anchor: { ...m.anchor, createdAt },
      media: m.media ? { ...m.media } : undefined,
      quote: m.quote ? { ...m.quote } : undefined,
    }
    if (!copy.media) delete copy.media
    if (!copy.quote) delete copy.quote
    const list = messagesBySession.get(m.sessionId) ?? []
    list.push(copy)
    messagesBySession.set(m.sessionId, list)
    messageById.set(m.id, copy)
  }
  for (const list of messagesBySession.values()) list.sort((a, b) => a.seq - b.seq)

  const contacts = new Map<string, WxContact>()
  const contactList: WxContact[] = []
  for (const c of fixture.contacts) {
    const copy: WxContact = { ...c }
    if (c.lastContactAt !== undefined) copy.lastContactAt = t(c.lastContactAt)
    contacts.set(c.username, copy)
    contactList.push(copy)
  }

  const account: WxAccount = { ...fixture.account }
  const selfContact: WxContact = { username: account.wxid, nickname: account.nickname ?? account.wxid, kind: 'friend' }

  return {
    account,
    selfContact,
    sessions,
    messagesBySession,
    messageById,
    contacts,
    contactList,
    groupMembers: { ...fixture.groupMembers },
    range: { from: Number.isFinite(min) ? min + shift : now, to: fixture.messages.length ? max + shift : now },
  }
}

export function previewFor(m: WxMessage): string {
  switch (m.kind) {
    case 'image':
      return '[图片]'
    case 'video':
      return '[视频]'
    case 'voice':
      return `[语音] ${Math.max(1, Math.round((m.media?.durationMs ?? 0) / 1000))}"`
    case 'sticker':
      return '[动画表情]'
    case 'file':
      return `[文件] ${m.media?.fileName ?? ''}`.trim()
    case 'link':
      return `[链接] ${m.text}`
    default:
      return m.text
  }
}

/** Text a keyword search should look at: body, voice transcript, quoted text, file name. */
export function searchableText(m: WxMessage): string {
  const parts = [m.text]
  if (m.media?.transcript) parts.push(m.media.transcript)
  if (m.media?.fileName) parts.push(m.media.fileName)
  if (m.quote?.text) parts.push(m.quote.text)
  return parts.filter(Boolean).join(' ')
}

export function contactDisplayName(c: WxContact | undefined, fallback = ''): string {
  return c?.remark ?? c?.nickname ?? fallback
}

/** Resolve a member username to a contact (self included); unknown ids become strangers. */
export function contactFor(data: DatasetIndex, username: string): WxContact {
  if (username === data.account.wxid) return data.selfContact
  return data.contacts.get(username) ?? { username, nickname: username, kind: 'stranger' }
}

/** Contacts derived from group sessions, for listContacts({ kind: 'group' }). */
export function groupContacts(data: DatasetIndex): WxContact[] {
  const out: WxContact[] = []
  for (const s of data.sessions.values()) {
    if (s.kind !== 'group') continue
    out.push({ username: s.id, nickname: s.title, kind: 'group', lastContactAt: s.lastMessageAt })
  }
  return out
}

export function localDateKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
