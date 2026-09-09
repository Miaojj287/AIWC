/**
 * Classification helpers shared by the WCDB reader and the mirror: username → session kind,
 * local_type (+ appmsg subtype) → MessageKind.
 */
import type { MessageKind, SessionKind, WxContact } from '@aiwc/protocol'
import { extractXmlValue } from './xml'

/**
 * System / service accounts (never treated as chats). Source: AIWC_ORG
 * docs/superpowers/specs/2026-07-20-home-memory-lounge-design.md `RecentContactsRail`.
 */
export const SYSTEM_USERNAMES: ReadonlySet<string> = new Set([
  'filehelper',
  'weixin',
  'qqmail',
  'qmessage',
  'fmessage',
  'medianote',
  'floatbottle',
  'newsapp',
  'brandsessionholder',
  'brandservicesessionholder',
  'notifymessage',
  'opencustomerservicemsg',
  'notification_messages',
  'userexperience_alarm',
])

export const SYSTEM_USERNAME_PREFIXES: readonly string[] = ['fake_', 'service_', 'weixin', 'notifymessage']
export const SYSTEM_USERNAME_SUFFIXES: readonly string[] = ['@kefu.openim', '@app', '@qqim']

export function isSystemUsername(username: string): boolean {
  const lower = String(username ?? '').trim().toLowerCase().replace(/^@+/, '')
  if (!lower) return true
  if (SYSTEM_USERNAMES.has(lower)) return true
  if (SYSTEM_USERNAME_PREFIXES.some((p) => lower.startsWith(p))) return true
  if (SYSTEM_USERNAME_SUFFIXES.some((s) => lower.endsWith(s))) return true
  return false
}

export function isGroupUsername(username: string): boolean {
  return /@(im\.)?chatroom$/i.test(String(username ?? '').trim())
}

export function isOfficialUsername(username: string): boolean {
  return /^gh_/i.test(String(username ?? '').trim())
}

/** chatroom → group; gh_ → official; system list → system; everything else (incl. @openim) → dm. */
export function sessionKindFromUsername(username: string): SessionKind {
  const u = String(username ?? '').trim()
  if (isGroupUsername(u)) return 'group'
  if (isOfficialUsername(u)) return 'official'
  if (isSystemUsername(u)) return 'system'
  return 'dm'
}

export function contactKindFromUsername(username: string, hint?: { isFriend?: boolean }): WxContact['kind'] {
  const kind = sessionKindFromUsername(username)
  if (kind === 'group') return 'group'
  if (kind === 'official' || kind === 'system') return 'official'
  return hint?.isFriend === false ? 'stranger' : 'friend'
}

/** WeChat 4.x packs the appmsg subtype into the high 32 bits of local_type (e.g. 244813135921 = 57<<32 | 49). */
export function splitLocalType(localType: number): { base: number; appType?: number } {
  if (!Number.isFinite(localType)) return { base: 0 }
  if (localType > 0xffffffff) {
    const high = Math.floor(localType / 0x100000000)
    const low = localType % 0x100000000
    return { base: low, appType: high }
  }
  return { base: localType }
}

export function messageKindFromAppType(appType: number | undefined): MessageKind {
  switch (appType) {
    case 57:
      return 'quote'
    case 6:
    case 74:
      return 'file'
    case 2000:
    case 2001:
      return 'transfer'
    case 8:
    case 15:
      return 'sticker'
    case 87:
      return 'system'
    case 1:
    case 2:
      return 'text'
    case 3:
    case 5:
    case 4:
    case 19:
    case 33:
    case 36:
    case 40:
    case 49:
    case 51:
    case 53:
    case 62:
    case 63:
      return 'link'
    default:
      return appType === undefined ? 'link' : 'link'
  }
}

export interface ClassifyInput {
  localType: number
  content?: string | null
}

/** local_type (+ content sniff) → MessageKind. Pure; safe for both WCDB rows and fixtures. */
export function classifyKind(input: ClassifyInput): MessageKind {
  const { base, appType: packed } = splitLocalType(Number(input.localType))
  const content = input.content ?? ''
  const sniffAppType = (): number | undefined => {
    if (packed !== undefined) return packed
    const t = Number.parseInt(extractXmlValue(content, 'type'), 10)
    return Number.isFinite(t) ? t : undefined
  }
  switch (base) {
    case 1:
      return 'text'
    case 3:
      return 'image'
    case 34:
      return 'voice'
    case 42:
      return 'card'
    case 43:
    case 62:
      return 'video'
    case 47:
      return 'sticker'
    case 48:
      return 'location'
    case 49:
      return messageKindFromAppType(sniffAppType())
    case 50:
      return 'other'
    case 10000:
      return /revoke|撤回/i.test(content) ? 'revoke' : 'system'
    case 10002:
      return /revokemsg|撤回/i.test(content) ? 'revoke' : 'system'
    default: {
      const t = sniffAppType()
      if (t === 57) return 'quote'
      if (t !== undefined && content.includes('<appmsg')) return messageKindFromAppType(t)
      return 'other'
    }
  }
}
