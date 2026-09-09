/**
 * Group-chat fallback for a thin DM corpus.
 *
 * Plenty of real friendships live mostly in group chats: the DM has forty messages and the clone
 * fails, while there are two thousand lines of the same person talking three sessions away. This
 * module collects those lines — but only for the STYLE half of the profile.
 *
 * Hard rule (why pairs are not produced here): in a group, a reply usually answers someone else, so
 * pairing "previous message → their message" manufactures wrong Q/A. A wrong pair is worse than a
 * missing one, because retrieval will confidently serve it at chat time. So this returns transcript
 * chunks only; `pairs.jsonl` stays DM-only.
 *
 * Cost control: group membership is probed with a 1-row `senderIds` query per recent group (which
 * also filters out groups the person never speaks in), and only the groups that hit are read.
 */
import type { Millis, SubstrateService, WxMessage } from '@aiwc/protocol'
import { truncateChars } from '../internal/text'
import { BURST_JOINER, MSG_CHAR_CAP, PROFILE_CHUNK_CHARS, TURN_GAP_MS, usableText } from './corpus'

/** Recent group sessions probed for membership. */
export const SCAN_GROUPS = 30
/** Groups actually read after the probe. */
export const MAX_GROUPS = 6
export const PER_GROUP_MESSAGES = 1200
/** Stop early once this many of their lines are collected. */
export const TARGET_LINES = 600
export const MAX_GROUP_CHUNKS = 3
/** A preceding line older than this is not context, it is a different conversation. */
const CONTEXT_GAP_MS = 10 * 60_000
const CONTEXT_CHAR_CAP = 80

export interface GroupCorpus {
  /** Transcript chunks for the style/deep extraction; each carries its own provenance marker. */
  chunks: string[]
  /** How many of the contact's messages were collected. */
  messageCount: number
  sessionCount: number
}

interface Snippet {
  at: Millis
  contextLabel: string
  contextText: string
  texts: string[]
}

export const EMPTY_GROUP_CORPUS: GroupCorpus = { chunks: [], messageCount: 0, sessionCount: 0 }

/**
 * Tells the model what it is reading. Without this the extractor happily attributes a群友's opinion
 * to the person being profiled, or reads 「我」 as the user when the user is not even in the group.
 */
function marker(name: string): string {
  return `（以下是「${name}」在群聊里的发言节选；「群友」是群里的其他人，「我」不一定在场。只提取关于「${name}」本人的信息，注意群里的语气通常比私聊更随意）`
}

function snippetText(s: Snippet, name: string): string {
  const lines: string[] = []
  if (s.contextText) lines.push(`${s.contextLabel}: ${s.contextText}`)
  lines.push(`${name}: ${s.texts.join(BURST_JOINER)}`)
  return lines.join('\n')
}

/** Their consecutive lines merged into turns, each carrying the line that preceded it. */
export function extractGroupSnippets(messages: readonly WxMessage[], contactId: string): Snippet[] {
  const out: Snippet[] = []
  let lastOtherLabel = ''
  let lastOtherText = ''
  let lastOtherAt = 0
  let prevAt = 0
  for (const m of messages) {
    const text = usableText(m)
    if (!text) continue
    if (!m.isSelf && m.senderId === contactId) {
      const last = out[out.length - 1]
      if (last && m.createdAt - prevAt <= TURN_GAP_MS) last.texts.push(truncateChars(text, MSG_CHAR_CAP))
      else {
        const fresh = lastOtherText && m.createdAt - lastOtherAt <= CONTEXT_GAP_MS
        out.push({
          at: m.createdAt,
          contextLabel: fresh ? lastOtherLabel : '',
          contextText: fresh ? truncateChars(lastOtherText, CONTEXT_CHAR_CAP) : '',
          texts: [truncateChars(text, MSG_CHAR_CAP)],
        })
      }
      prevAt = m.createdAt
    } else {
      lastOtherLabel = m.isSelf ? '我' : '群友'
      lastOtherText = text
      lastOtherAt = m.createdAt
    }
  }
  return out
}

export function renderGroupChunks(snippets: readonly Snippet[], name: string, maxChunks = MAX_GROUP_CHUNKS): string[] {
  const head = marker(name)
  const chunks: string[] = []
  let cur: string[] = [head]
  let chars = head.length
  for (const s of snippets) {
    const block = snippetText(s, name)
    if (chars + block.length > PROFILE_CHUNK_CHARS && cur.length > 1) {
      chunks.push(cur.join('\n'))
      cur = [head]
      chars = head.length
    }
    cur.push(block)
    chars += block.length + 1
  }
  if (cur.length > 1) chunks.push(cur.join('\n'))
  return chunks.slice(-maxChunks)
}

export interface CollectGroupCorpusOptions {
  signal?: AbortSignal
  onProgress?: (detail: string) => void
  maxGroups?: number
}

/**
 * Best-effort: any failing group is skipped, and an empty result simply means the DM stays the only
 * source (the caller then reports 语料不足 as before).
 */
export async function collectGroupCorpus(
  substrate: SubstrateService,
  contactId: string,
  displayName: string,
  opts: CollectGroupCorpusOptions = {},
): Promise<GroupCorpus> {
  const maxGroups = opts.maxGroups ?? MAX_GROUPS
  let groups: string[]
  try {
    const res = await substrate.listSessions({ kind: 'group', limit: SCAN_GROUPS })
    groups = res.items.map((s) => s.id)
  } catch {
    return EMPTY_GROUP_CORPUS
  }
  if (groups.length === 0) return EMPTY_GROUP_CORPUS

  const speaking: string[] = []
  for (const id of groups) {
    if (opts.signal?.aborted) return EMPTY_GROUP_CORPUS
    if (speaking.length >= maxGroups) break
    try {
      const probe = await substrate.listMessages({ sessionId: id, senderIds: [contactId], limit: 1 })
      if (probe.items.length > 0) speaking.push(id)
    } catch {
      /* skip this group */
    }
  }
  if (speaking.length === 0) return EMPTY_GROUP_CORPUS

  const all: Snippet[] = []
  let messageCount = 0
  let sessionCount = 0
  for (const id of speaking) {
    if (opts.signal?.aborted) break
    if (messageCount >= TARGET_LINES) break
    try {
      opts.onProgress?.(`读取群聊 ${sessionCount + 1}/${speaking.length}（已收集 ${messageCount} 条发言）`)
      const page = await substrate.listMessages({ sessionId: id, beforeSeq: Number.MAX_SAFE_INTEGER, limit: PER_GROUP_MESSAGES })
      const ordered = page.items.slice().sort((a, b) => a.seq - b.seq)
      const snippets = extractGroupSnippets(ordered, contactId)
      if (snippets.length === 0) continue
      sessionCount++
      for (const s of snippets) messageCount += s.texts.length
      all.push(...snippets)
    } catch {
      /* skip this group */
    }
  }
  if (all.length === 0) return EMPTY_GROUP_CORPUS
  all.sort((a, b) => a.at - b.at)
  return { chunks: renderGroupChunks(all, displayName), messageCount, sessionCount }
}
