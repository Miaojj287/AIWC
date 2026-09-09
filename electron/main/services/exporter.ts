/**
 * Export helpers: WeChat session transcripts (markdown / json / html) and Agent thread transcripts
 * (markdown). Pure string builders + one thin writer; the IPC layer decides where files go.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryItem, WxMessage, WxSession } from '@aiwc/protocol'

export type SessionExportFormat = 'html' | 'markdown' | 'json' | 'excel'

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
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return (cleaned || fallback).slice(0, 80)
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function messageBody(m: WxMessage): string {
  switch (m.kind) {
    case 'text':
      return m.text
    case 'image':
      return `[图片]${m.media?.path ? ` ${m.media.path}` : ''}`
    case 'voice':
      return `[语音${m.media?.durationMs ? ` ${Math.round(m.media.durationMs / 1000)}s` : ''}]${m.media?.transcript ? ` ${m.media.transcript}` : ''}`
    case 'video':
      return '[视频]'
    case 'file':
      return `[文件] ${m.media?.fileName ?? m.text}`
    case 'sticker':
      return '[表情]'
    case 'quote':
      return `${m.quote ? `> ${m.quote.senderName ?? ''}: ${m.quote.text}\n` : ''}${m.text}`
    case 'revoke':
      return '[消息已撤回]'
    case 'system':
      return `[系统] ${m.text}`
    default:
      return m.text || `[${m.kind}]`
  }
}

export function sessionToMarkdown(session: Pick<WxSession, 'id' | 'title' | 'kind'>, messages: WxMessage[]): string {
  const lines: string[] = [`# ${session.title}`, '', `- 会话：\`${session.id}\`（${session.kind}）`, `- 消息数：${messages.length}`, `- 导出时间：${formatTimestamp(Date.now())}`, '']
  let lastDay = ''
  for (const m of messages) {
    const day = formatTimestamp(m.createdAt).slice(0, 10)
    if (day !== lastDay) {
      lines.push('', `## ${day}`, '')
      lastDay = day
    }
    const who = m.isSelf ? '我' : m.senderName ?? m.senderId
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
      const who = m.isSelf ? '我' : m.senderName ?? m.senderId
      const cls = m.isSelf ? 'msg self' : 'msg'
      return `<div class="${cls}"><div class="meta"><span class="who">${escapeHtml(who)}</span><span class="time">${formatTimestamp(m.createdAt)}</span></div><div class="body">${escapeHtml(messageBody(m)).replace(/\n/g, '<br>')}</div></div>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(session.title)}</title>
<style>
body{margin:0;padding:24px;background:#15161c;color:#e8e9ee;font:14px/22px -apple-system,"PingFang SC","Noto Sans SC",sans-serif}
h1{font-size:20px;margin:0 0 4px}.sub{color:#9c9ea5;font-size:12px;margin-bottom:24px}
.msg{max-width:720px;margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#1e1f26;border:1px solid rgba(255,255,255,.06)}
.msg.self{background:#132F63;margin-left:auto}
.meta{display:flex;gap:8px;font-size:11px;color:#9c9ea5;margin-bottom:4px}.who{color:#b9bbc2}
.body{white-space:pre-wrap;word-break:break-word}
</style></head><body>
<h1>${escapeHtml(session.title)}</h1>
<div class="sub">${escapeHtml(session.id)} · ${messages.length} 条 · 导出于 ${formatTimestamp(Date.now())}</div>
${rows}
</body></html>
`
}

export function buildSessionExport(format: SessionExportFormat, session: Pick<WxSession, 'id' | 'title' | 'kind'>, messages: WxMessage[]): { content: string; ext: string } {
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
  const head = ['时间', '发送者', '是否本人', '类型', '内容'].map(esc).join(',')
  const rows = messages.map((m) => [formatTimestamp(m.createdAt), m.senderName ?? m.senderId, m.isSelf ? '是' : '否', m.kind, messageBody(m)].map(esc).join(','))
  return `\uFEFF${[head, ...rows].join('\r\n')}\r\n`
}

export function threadToMarkdown(title: string, items: HistoryItem[]): string {
  const lines: string[] = [`# ${title}`, '', `导出时间：${formatTimestamp(Date.now())}`, '']
  for (const it of items) {
    switch (it.type) {
      case 'user_message':
        lines.push('## 用户', '', ...it.content.map((c) => (c.type === 'text' ? c.text : `[${c.type}${'name' in c && c.name ? ` ${c.name}` : ''}]`)), '')
        break
      case 'assistant_message':
        lines.push('## Agent', '', it.text, '')
        break
      case 'tool_call':
        lines.push(`> 调用工具 \`${it.toolName}\``, '', '```json', JSON.stringify(it.input, null, 2), '```', '')
        break
      case 'tool_result': {
        const out = it.output.type === 'text' ? it.output.text : it.output.type === 'json' ? JSON.stringify(it.output.value, null, 2) : '[image]'
        lines.push(`> 工具结果 \`${it.toolName}\`${it.isError ? '（错误）' : ''}${it.truncated ? '（已截断）' : ''}`, '', '```', out, '```', '')
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
