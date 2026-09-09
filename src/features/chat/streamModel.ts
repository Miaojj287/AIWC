/**
 * Pure helpers for the message stream (DESIGN-SPEC §1.2 消息流): merging pages, inserting day pills,
 * locating anchors and producing copy text. No React, no bridge — all covered by streamModel.test.ts.
 */
import type { MessageKind, WxMessage } from '@aiwc/protocol'

export type StreamRow = { kind: 'day'; id: string; at: number } | { kind: 'message'; id: string; message: WxMessage }

export type MergeMode = 'replace' | 'prepend' | 'append'

function localDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function sameLocalDay(a: number, b: number): boolean {
  return localDayKey(a) === localDayKey(b)
}

/** Sort by seq (then id for stability) and drop duplicate ids — pages from the substrate may overlap. */
export function mergeMessages(existing: readonly WxMessage[], incoming: readonly WxMessage[], mode: MergeMode): WxMessage[] {
  const source = mode === 'replace' ? incoming : mode === 'prepend' ? [...incoming, ...existing] : [...existing, ...incoming]
  const seen = new Set<string>()
  const out: WxMessage[] = []
  for (const m of source) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  out.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

/** Interleave a day pill before the first message of every local day. Messages must be ascending. */
export function buildRows(messages: readonly WxMessage[]): StreamRow[] {
  const rows: StreamRow[] = []
  let lastDay: string | undefined
  for (const m of messages) {
    const day = localDayKey(m.createdAt)
    if (day !== lastDay) {
      rows.push({ kind: 'day', id: `day:${day}`, at: m.createdAt })
      lastDay = day
    }
    rows.push({ kind: 'message', id: m.id, message: m })
  }
  return rows
}

export function rowIndexOfMessage(rows: readonly StreamRow[], messageId: string): number {
  return rows.findIndex((r) => r.kind === 'message' && r.id === messageId)
}

const KIND_PLACEHOLDER: Partial<Record<MessageKind, string>> = {
  image: '[图片]',
  voice: '[语音]',
  video: '[视频]',
  file: '[文件]',
  sticker: '[表情]',
  link: '[链接]',
  card: '[名片]',
  location: '[位置]',
  transfer: '[转账]',
  other: '[消息]',
}

/** What "复制" puts on the clipboard for one message. */
export function plainTextOf(m: WxMessage): string {
  if (m.rich) return [m.rich.title, m.rich.description, m.rich.amount, m.rich.url,
    ...(m.rich.entries ?? []).map((entry) => [entry.title, entry.description, entry.url].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n')
  switch (m.kind) {
    case 'text':
      return m.text
    case 'quote':
      return m.quote ? `「${m.quote.senderName ?? ''}：${m.quote.text}」\n${m.text}` : m.text
    case 'voice':
      return m.media?.transcript ? m.media.transcript : m.text || '[语音]'
    case 'file':
      return m.media?.fileName ? `[文件] ${m.media.fileName}` : '[文件]'
    case 'system':
    case 'revoke':
      return m.text
    case 'link':
      return m.text || '[链接]'
    default:
      return m.text || KIND_PLACEHOLDER[m.kind] || ''
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Multi-message copy: one line per message with time and sender. */
export function transcriptOf(messages: readonly WxMessage[], selfName = '我'): string {
  return messages
    .map((m) => {
      const d = new Date(m.createdAt)
      const time = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      const who = m.kind === 'system' ? '系统' : m.isSelf ? selfName : m.senderName ?? m.senderId
      return `[${time}] ${who}: ${plainTextOf(m)}`
    })
    .join('\n')
}

/** Centered pills (system notices and recalls) are not selectable / quotable. */
export function isNoticeKind(kind: MessageKind): boolean {
  return kind === 'system' || kind === 'revoke'
}

/** Selection state of the 全选 checkbox against the loaded messages. */
export function selectAllState(loaded: readonly WxMessage[], selected: ReadonlySet<string>): boolean | 'indeterminate' {
  const selectable = loaded.filter((m) => !isNoticeKind(m.kind))
  if (selectable.length === 0 || selected.size === 0) return false
  const picked = selectable.filter((m) => selected.has(m.id)).length
  if (picked === 0) return false
  return picked === selectable.length ? true : 'indeterminate'
}

/** Ids of every selectable loaded message (全选). */
export function selectableIds(loaded: readonly WxMessage[]): string[] {
  return loaded.filter((m) => !isNoticeKind(m.kind)).map((m) => m.id)
}
