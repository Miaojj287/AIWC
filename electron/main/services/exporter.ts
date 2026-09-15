/**
 * Export helpers: WeChat session transcripts (markdown / json / html / csv) and Agent thread transcripts
 * (markdown). Pure string builders, the session-export request check and message collector, and one
 * thin writer; the IPC layer decides where files go.
 * Headings and placeholders follow the UI language at export time (@aiwc/i18n `main.export.*`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { HistoryItem, InvokeReq, SubstrateService, WxMessage, WxSession } from '@aiwc/protocol'
import { mainLanguage, t } from '../i18n'

/** Messages requested per listMessages page while collecting a session export. */
const EXPORT_PAGE_SIZE = 500
/** Hard cap on the number of messages written into one export file. */
const EXPORT_MAX_MESSAGES = 100_000
/** Longest session / message / sender id accepted from the renderer. */
const MAX_EXPORT_ID_CHARS = 512
/** Longest target directory accepted from the renderer. */
const MAX_EXPORT_DIR_CHARS = 4_096
/** Upper bound for the sender filter (WeChat groups hold at most 500 members). */
const MAX_EXPORT_SENDER_IDS = 2_000

export type SessionExportRequest = InvokeReq<'substrate:export'>
export type SessionExportFormat = SessionExportRequest['format']

/** Keyed by format so a format added to the IPC contract does not compile until it is accepted here. */
const SESSION_EXPORT_FORMATS = {
  html: 'html',
  markdown: 'markdown',
  json: 'json',
  excel: 'excel',
} as const satisfies { [F in SessionExportFormat]: F }

const exportId = z.string().min(1).max(MAX_EXPORT_ID_CHARS)

const sessionExportRequestSchema = z.strictObject({
  sessionId: exportId,
  format: z.enum(SESSION_EXPORT_FORMATS),
  from: z.number().optional(),
  to: z.number().optional(),
  messageIds: z.array(exportId).max(EXPORT_MAX_MESSAGES).optional(),
  senderIds: z.array(exportId).max(MAX_EXPORT_SENDER_IDS).optional(),
  outDir: z.string().min(1).max(MAX_EXPORT_DIR_CHARS).optional(),
}) satisfies z.ZodType<SessionExportRequest>

export type ParsedSessionExportRequest =
  | { ok: true; request: SessionExportRequest }
  /** `where` names the offending field for the log; it never echoes the value. */
  | { ok: false; where: string }

/**
 * Runtime check of the renderer's `substrate:export` request (the channel writes a file, AGENTS.md §3.6).
 * A malformed filter is rejected rather than read as "no filter", which would export everyone.
 */
export function parseSessionExportRequest(raw: unknown): ParsedSessionExportRequest {
  const parsed = sessionExportRequestSchema.safeParse(raw)
  if (parsed.success) return { ok: true, request: parsed.data }
  const first = parsed.error.issues[0]
  return { ok: false, where: first?.path.length ? first.path.join('.') : (first?.code ?? 'request') }
}

export interface CollectSessionExportOptions {
  /** Messages per listMessages call (default EXPORT_PAGE_SIZE). */
  pageSize?: number
  /** Stop after this many messages (default EXPORT_MAX_MESSAGES). */
  maxMessages?: number
}

/**
 * Pages through one session in seq order and keeps what the export request selects. The date range and
 * sender filter are forwarded to the substrate; ticked ids and senders are enforced again here, so the
 * written file never contains a sender the user filtered out, whatever the substrate honours.
 */
export async function collectSessionExportMessages(
  listMessages: SubstrateService['listMessages'],
  req: Pick<SessionExportRequest, 'sessionId' | 'from' | 'to' | 'messageIds' | 'senderIds'>,
  opts: CollectSessionExportOptions = {},
): Promise<WxMessage[]> {
  const pageSize = opts.pageSize ?? EXPORT_PAGE_SIZE
  const maxMessages = opts.maxMessages ?? EXPORT_MAX_MESSAGES
  const wantedIds = req.messageIds ? new Set(req.messageIds) : undefined
  const senderIds = req.senderIds?.length ? [...new Set(req.senderIds)] : undefined
  const wantedSenders = senderIds ? new Set(senderIds) : undefined
  const messages: WxMessage[] = []
  let afterSeq = 0
  while (messages.length < maxMessages) {
    const page = await listMessages({
      sessionId: req.sessionId,
      afterSeq,
      limit: pageSize,
      from: req.from,
      to: req.to,
      senderIds,
    })
    for (const m of page.items) {
      if (wantedIds && !wantedIds.has(m.id)) continue
      if (wantedSenders && !wantedSenders.has(m.senderId)) continue
      messages.push(m)
    }
    const last = page.items[page.items.length - 1]
    // A page that does not advance the cursor would repeat forever when every row is filtered out.
    if (!page.hasMore || !last || last.seq <= afterSeq) break
    afterSeq = last.seq
  }
  return messages.slice(0, maxMessages)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatDateForFile(ms = Date.now()): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** Replace characters that are invalid in file names on macOS / Windows. */
export function safeFileName(name: string, fallback = 'export'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, 80)
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function messageBody(m: WxMessage): string {
  switch (m.kind) {
    case 'text':
      return m.text
    case 'image':
      return `${t('main.export.image')}${m.media?.path ? ` ${m.media.path}` : ''}`
    case 'voice':
      return `${t('main.export.voice', { duration: m.media?.durationMs ? ` ${Math.round(m.media.durationMs / 1000)}s` : '' })}${m.media?.transcript ? ` ${m.media.transcript}` : ''}`
    case 'video':
      return t('main.export.video')
    case 'file':
      return `${t('main.export.file')} ${m.media?.fileName ?? m.text}`
    case 'sticker':
      return t('main.export.sticker')
    case 'quote':
      return `${m.quote ? `> ${m.quote.senderName ?? ''}: ${m.quote.text}\n` : ''}${m.text}`
    case 'revoke':
      return t('main.export.revoked')
    case 'system':
      return `${t('main.export.system')} ${m.text}`
    default:
      return m.text || `[${m.kind}]`
  }
}

export function sessionToMarkdown(session: Pick<WxSession, 'id' | 'title' | 'kind'>, messages: WxMessage[]): string {
  const lines: string[] = [
    `# ${session.title}`,
    '',
    t('main.export.mdSessionLine', { id: session.id, kind: session.kind }),
    t('main.export.mdCountLine', { n: messages.length }),
    t('main.export.mdExportedLine', { time: formatTimestamp(Date.now()) }),
    '',
  ]
  let lastDay = ''
  for (const m of messages) {
    const day = formatTimestamp(m.createdAt).slice(0, 10)
    if (day !== lastDay) {
      lines.push('', `## ${day}`, '')
      lastDay = day
    }
    const who = m.isSelf ? t('main.export.me') : (m.senderName ?? m.senderId)
    lines.push(`**${who}** · ${formatTimestamp(m.createdAt).slice(11)}  `)
    lines.push(messageBody(m).split('\n').join('  \n'))
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function sessionToJson(session: Pick<WxSession, 'id' | 'title' | 'kind'>, messages: WxMessage[]): string {
  return `${JSON.stringify({ session, exportedAt: Date.now(), count: messages.length, messages }, null, 2)}\n`
}

export function sessionToHtml(session: Pick<WxSession, 'id' | 'title' | 'kind'>, messages: WxMessage[]): string {
  const rows = messages
    .map((m) => {
      const who = m.isSelf ? t('main.export.me') : (m.senderName ?? m.senderId)
      const cls = m.isSelf ? 'msg self' : 'msg'
      return `<div class="${cls}"><div class="meta"><span class="who">${escapeHtml(who)}</span><span class="time">${formatTimestamp(m.createdAt)}</span></div><div class="body">${escapeHtml(messageBody(m)).replace(/\n/g, '<br>')}</div></div>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="${mainLanguage()}"><head><meta charset="utf-8"><title>${escapeHtml(session.title)}</title>
<style>
body{margin:0;padding:24px;background:#181818;color:#ffffff;font:14px/22px -apple-system,"PingFang SC","Noto Sans SC",sans-serif}
h1{font-size:20px;margin:0 0 4px}.sub{color:#adadad;font-size:12px;margin-bottom:24px}
.msg{max-width:720px;margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#292929;border:1px solid rgba(255,255,255,.0876)}
.msg.self{background:#132F63;margin-left:auto}
.meta{display:flex;gap:8px;font-size:11px;color:#9c9ea5;margin-bottom:4px}.who{color:#b9bbc2}
.body{white-space:pre-wrap;word-break:break-word}
</style></head><body>
<h1>${escapeHtml(session.title)}</h1>
<div class="sub">${escapeHtml(session.id)} · ${escapeHtml(t('main.export.htmlSubtitle', { n: messages.length, time: formatTimestamp(Date.now()) }))}</div>
${rows}
</body></html>
`
}

export function buildSessionExport(
  format: SessionExportFormat,
  session: Pick<WxSession, 'id' | 'title' | 'kind'>,
  messages: WxMessage[],
): { content: string; ext: string } {
  switch (format) {
    case 'markdown':
      return { content: sessionToMarkdown(session, messages), ext: 'md' }
    case 'json':
      return { content: sessionToJson(session, messages), ext: 'json' }
    case 'html':
      return { content: sessionToHtml(session, messages), ext: 'html' }
    case 'excel':
      // No spreadsheet dependency in the main bundle: emit UTF-8 CSV with BOM (opens in Excel).
      return { content: sessionToCsv(messages), ext: 'csv' }
  }
}

export function sessionToCsv(messages: WxMessage[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const head = [
    t('main.export.csvTime'),
    t('main.export.csvSender'),
    t('main.export.csvIsSelf'),
    t('main.export.csvKind'),
    t('main.export.csvContent'),
  ]
    .map(esc)
    .join(',')
  const rows = messages.map((m) =>
    [
      formatTimestamp(m.createdAt),
      m.senderName ?? m.senderId,
      m.isSelf ? t('main.export.yes') : t('main.export.no'),
      m.kind,
      messageBody(m),
    ]
      .map(esc)
      .join(','),
  )
  return `\uFEFF${[head, ...rows].join('\r\n')}\r\n`
}

export function threadToMarkdown(title: string, items: HistoryItem[]): string {
  const lines: string[] = [`# ${title}`, '', t('main.export.exportedLine', { time: formatTimestamp(Date.now()) }), '']
  for (const it of items) {
    switch (it.type) {
      case 'user_message':
        lines.push(
          `## ${t('main.export.user')}`,
          '',
          ...it.content.map((c) =>
            c.type === 'text' ? c.text : `[${c.type}${'name' in c && c.name ? ` ${c.name}` : ''}]`,
          ),
          '',
        )
        break
      case 'assistant_message':
        lines.push('## Agent', '', it.text, '')
        break
      case 'tool_call':
        lines.push(
          `> ${t('main.export.toolCall')} \`${it.toolName}\``,
          '',
          '```json',
          JSON.stringify(it.input, null, 2),
          '```',
          '',
        )
        break
      case 'tool_result': {
        const out =
          it.output.type === 'text'
            ? it.output.text
            : it.output.type === 'json'
              ? JSON.stringify(it.output.value, null, 2)
              : '[image]'
        lines.push(
          `> ${t('main.export.toolResult')} \`${it.toolName}\`${it.isError ? t('main.export.toolError') : ''}${it.truncated ? t('main.export.toolTruncated') : ''}`,
          '',
          '```',
          out,
          '```',
          '',
        )
        break
      }
      default:
        break
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function writeExport(dir: string, baseName: string, ext: string, content: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${safeFileName(baseName)}-${formatDateForFile()}.${ext}`)
  writeFileSync(file, content, 'utf8')
  return file
}
