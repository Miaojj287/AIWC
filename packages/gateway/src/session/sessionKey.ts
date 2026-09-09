/**
 * Session key = the single source of truth for "which agent thread does this message belong to".
 *
 *   dm    → agent:<channel>:dm:<peerId>
 *   group → agent:<channel>:group:<chatId>:<peerId>      (groups are isolated per person)
 *   + ':<threadId>' suffix when the source carries a sub-thread.
 *
 * Mirrors Hermes `build_session_key` (group_sessions_per_user = true) without the platform-specific
 * identifier canonicalisation WeChat does not need.
 */
import type { SessionKey, SessionSource } from '@aiwc/protocol'

const NAMESPACE = 'agent'

/** Session keys are ':'-joined; strip the separator from identifiers so a crafted id cannot alias another chat. */
function safeSegment(value: string): string {
  return value.replace(/:/g, '_').trim() || '_'
}

export function buildSessionKey(source: SessionSource): SessionKey {
  const parts: string[] = [NAMESPACE, source.channel]
  if (source.chatType === 'dm') {
    // For DMs chatId equals peerId by contract; fall back to chatId when an adapter only fills one.
    const peer = source.peerId || source.chatId
    parts.push('dm', safeSegment(peer))
  } else {
    const chat = source.chatId || source.peerId
    parts.push('group', safeSegment(chat))
    if (source.peerId) parts.push(safeSegment(source.peerId))
  }
  if (source.threadId) parts.push(safeSegment(source.threadId))
  return parts.join(':') as SessionKey
}

/** Inverse helper for logs / UI: pulls the channel and chat id back out of a key. */
export function parseSessionKey(key: string): { channel: string; chatType: 'dm' | 'group'; chatId: string; peerId: string; threadId?: string } | undefined {
  const parts = key.split(':')
  if (parts.length < 4 || parts[0] !== NAMESPACE) return undefined
  const channel = parts[1] ?? ''
  const chatType = parts[2]
  if (chatType === 'dm') {
    const peerId = parts[3] ?? ''
    return { channel, chatType, chatId: peerId, peerId, threadId: parts[4] }
  }
  if (chatType === 'group') {
    const chatId = parts[3] ?? ''
    const peerId = parts[4] ?? ''
    return { channel, chatType, chatId, peerId, threadId: parts[5] }
  }
  return undefined
}
