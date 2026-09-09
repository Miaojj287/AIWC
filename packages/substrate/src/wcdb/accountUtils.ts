/**
 * Username / account-directory conventions of WeChat 4.x:
 *  - account dirs are `wxid_xxx_ab12` (wxid + 4-char suffix) or `<alias>_ab12`
 *  - `xxx@chatroom` = group, `gh_xxx` = official account, a fixed set of system usernames
 */
import type { SessionKind, WxContact } from '@aiwc/protocol'
import type { Row } from './rowDecoders'

const SYSTEM_USERNAMES = new Set([
  'filehelper', 'fmessage', 'floatbottle', 'medianote', 'newsapp', 'qmessage', 'qqmail', 'weixin',
  'brandsessionholder', 'brandservicesessionholder', 'notifymessage', 'opencustomerservicemsg',
  'notification_messages', 'userexperience_alarm', 'placeholder_foldgroup',
])

/** Virtual folder sessions that aggregate other sessions (not real chats). */
const VIRTUAL_FOLDER_USERNAMES = new Set(['brandsessionholder', '@brandsessionholder', '@placeholder_foldgroup', 'placeholder_foldgroup'])

/** `wxid_abcd_efgh` → `wxid_abcd`; `alias_1a2b` → `alias`. */
export function cleanAccountDirName(dirName: string): string {
  const trimmed = (dirName || '').trim()
  if (!trimmed) return trimmed
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = /^(wxid_[a-zA-Z0-9]+)/i.exec(trimmed)
    return match?.[1] ?? trimmed
  }
  const suffixMatch = /^(.+)_([a-zA-Z0-9]{4})$/.exec(trimmed)
  return suffixMatch?.[1] ?? trimmed
}

/** Lower-cased identity candidates for "me" (raw dir name + cleaned wxid). */
export function buildIdentityKeys(raw: string): string[] {
  const value = String(raw || '').trim()
  if (!value) return []
  const lowerRaw = value.toLowerCase()
  const cleaned = cleanAccountDirName(value).toLowerCase()
  return cleaned && cleaned !== lowerRaw ? [cleaned, lowerRaw] : [lowerRaw]
}

export function identityMatches(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => x === y || x.startsWith(`${y}_`) || y.startsWith(`${x}_`)))
}

export function isGroupUsername(username: string): boolean {
  return username.toLowerCase().includes('@chatroom')
}

export function isOfficialAccountUsername(username: string): boolean {
  return username.startsWith('gh_')
}

export function isVirtualFolderUsername(username: string): boolean {
  return VIRTUAL_FOLDER_USERNAMES.has(username.toLowerCase())
}

export function isSystemUsername(username: string): boolean {
  const lower = username.trim().toLowerCase()
  if (!lower) return true
  const normalized = lower.replace(/^@+/, '')
  if (SYSTEM_USERNAMES.has(lower) || SYSTEM_USERNAMES.has(normalized)) return true
  return lower.startsWith('fake_') || lower.includes('@kefu.openim') || lower.includes('service_')
}

/** WeCom (企业微信) external contacts keep the `@openim` suffix; customer-service bots are excluded. */
export function isWeComUsername(username: string): boolean {
  const lower = username.toLowerCase()
  return lower.includes('@openim') && !lower.includes('@kefu.openim')
}

/** Sessions we surface at all: drop virtual folders, customer-service and notification channels. */
export function shouldKeepSession(username: string): boolean {
  if (!username) return false
  if (isVirtualFolderUsername(username)) return false
  if (isOfficialAccountUsername(username) || isGroupUsername(username)) return true
  const lower = username.toLowerCase()
  const excludePrefixes = [
    'weixin', 'qqmail', 'fmessage', 'medianote', 'floatbottle', 'newsapp', 'brandservicesessionholder',
    'notifymessage', 'opencustomerservicemsg', 'notification_messages', 'userexperience_alarm',
  ]
  if (excludePrefixes.some((p) => lower === p || lower.startsWith(p))) return false
  if (lower.includes('@kefu.openim') || lower.includes('service_')) return false
  return true
}

export function classifySessionKind(username: string): SessionKind {
  if (isGroupUsername(username)) return 'group'
  if (isOfficialAccountUsername(username)) return 'official'
  if (isSystemUsername(username)) return 'system'
  return 'dm'
}

/** contact.db row → kind; null means "not a contact we list" (system / service accounts). */
export function classifyContactKind(username: string, row: Row): WxContact['kind'] | null {
  const lower = username.trim().toLowerCase()
  if (isSystemUsername(lower)) return null
  if (isGroupUsername(lower)) return 'group'
  if (isOfficialAccountUsername(lower)) return 'official'
  const rawType = row['local_type'] ?? row['type']
  const numericType = rawType === null || rawType === undefined || rawType === '' ? Number.NaN : Number(rawType)
  if (Number.isFinite(numericType) && numericType === 3) return 'official'
  // contact.flag bit 0 (0x1) is unset for strangers / deleted friends in WeChat 4.x exports we have seen;
  // the meaning of the flag word is not stable across versions, so only use it as a weak hint.
  const flag = Number(row['flag'] ?? 0)
  if (Number.isFinite(flag) && flag > 0 && (flag & 0x1) === 0 && (flag & 0x800) === 0) return 'stranger'
  return 'friend'
}

/** Contact flag bits (WeChat 4.x): bit 11 pinned, bit 28 collapsed group. */
export const CONTACT_FLAG = { PINNED: 0x800, COLLAPSED: 0x10000000 } as const

/** Preferred display name order: remark → nickname → alias → username. */
export function pickDisplayName(row: Row, fallback: string): string {
  for (const key of ['remark', 'nick_name', 'nickname', 'alias']) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

export function pickAvatarUrl(row: Row): string | undefined {
  for (const key of ['big_head_url', 'small_head_url']) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}
