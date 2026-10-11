/**
 * 导出会话 with the user's choices (ThreadExportOptions; every default is the privacy-safe one):
 *  - tool inputs and results are left out unless asked for — they carry WeChat chat text and ids;
 *  - reasoning is left out unless asked for;
 *  - identifiers are redacted (services/redact.ts) unless the user turns that off;
 *  - context fragments (memory snapshot, observed chatter) are never exported: they are prompt plumbing.
 */
import { homedir } from 'node:os'
import type { ContentPart, HistoryItem, ThreadExportOptions, ToolOutputContent } from '@aiwc/protocol'
import { t } from '../i18n'
import { formatTimestamp } from './exporter'
import { createRedactor } from './redact'

export interface ThreadExport {
  content: string
  ext: 'md' | 'json'
}

type ExportedItem =
  | { type: 'user'; at: number; text: string }
  | { type: 'assistant'; at: number; text: string; reasoning?: string }
  | { type: 'tool_call'; at: number; tool: string; input?: unknown }
  | { type: 'tool_result'; at: number; tool: string; isError: boolean; output?: string }
  | { type: 'summary'; at: number; text: string }
  | { type: 'aborted'; at: number }

const partText = (part: ContentPart): string =>
  part.type === 'text' ? part.text : t('main.export.attachment', { name: part.type === 'file' ? part.name : 'image' })

const outputText = (output: ToolOutputContent): string =>
  output.type === 'text' ? output.text : output.type === 'json' ? JSON.stringify(output.value, null, 2) : '[image]'

/** The items as exported, already filtered by the options. */
export function selectExportItems(items: readonly HistoryItem[], options: ThreadExportOptions): ExportedItem[] {
  const out: ExportedItem[] = []
  for (const it of items) {
    switch (it.type) {
      case 'user_message':
        out.push({ type: 'user', at: it.createdAt, text: it.content.map(partText).join('\n') })
        break
      case 'assistant_message': {
        const reasoning = options.includeReasoning ? it.reasoning?.trim() : undefined
        if (!it.text.trim() && !reasoning) break
        out.push({ type: 'assistant', at: it.createdAt, text: it.text, ...(reasoning ? { reasoning } : {}) })
        break
      }
      case 'tool_call':
        out.push({
          type: 'tool_call',
          at: it.createdAt,
          tool: it.toolName,
          ...(options.includeToolOutputs ? { input: it.input } : {}),
        })
        break
      case 'tool_result':
        if (!options.includeToolOutputs) break
        out.push({
          type: 'tool_result',
          at: it.createdAt,
          tool: it.toolName,
          isError: it.isError,
          output: outputText(it.output),
        })
        break
      case 'compaction_summary':
        out.push({ type: 'summary', at: it.createdAt, text: it.summary })
        break
      case 'turn_aborted':
        out.push({ type: 'aborted', at: it.createdAt })
        break
      case 'context_fragment':
      // a host check's report (the citation audit) is shown in the panel; the export keeps the answer itself
      case 'turn_check':
        break
    }
  }
  return out
}

function toMarkdown(title: string, items: ExportedItem[], options: ThreadExportOptions, exportedAt: number): string {
  const lines = [`# ${title}`, '', t('main.export.exportedLine', { time: formatTimestamp(exportedAt) })]
  if (!options.includeToolOutputs) lines.push('', `> ${t('main.export.toolOutputsOmitted')}`)
  if (options.redactIdentifiers) lines.push('', `> ${t('main.export.redactedNote')}`)
  lines.push('')
  for (const it of items) {
    switch (it.type) {
      case 'user':
        lines.push(`## ${t('main.export.user')}`, '', it.text, '')
        break
      case 'assistant':
        lines.push('## Agent', '')
        if (it.reasoning)
          lines.push(
            `<details><summary>${t('main.export.reasoning')}</summary>`,
            '',
            it.reasoning,
            '',
            '</details>',
            '',
          )
        if (it.text.trim()) lines.push(it.text, '')
        break
      case 'tool_call':
        lines.push(`> ${t('main.export.toolCall')} \`${it.tool}\``, '')
        if (it.input !== undefined) lines.push('```json', JSON.stringify(it.input, null, 2), '```', '')
        break
      case 'tool_result':
        lines.push(
          `> ${t('main.export.toolResult')} \`${it.tool}\`${it.isError ? t('main.export.toolError') : ''}`,
          '',
          '```',
          it.output ?? '',
          '```',
          '',
        )
        break
      case 'summary':
        lines.push(`> ${t('main.export.compacted')}`, '', it.text, '')
        break
      case 'aborted':
        lines.push(`_${t('main.export.aborted')}_`, '')
        break
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Render the export text. `redaction` defaults to this machine's home folder / user name. */
export function renderThreadExport(
  title: string,
  items: readonly HistoryItem[],
  options: ThreadExportOptions,
  opts: { now?: number; home?: string; username?: string } = {},
): ThreadExport {
  const exportedAt = opts.now ?? Date.now()
  const selected = selectExportItems(items, options)
  const raw =
    options.format === 'json'
      ? `${JSON.stringify({ title, exportedAt, options, items: selected }, null, 2)}\n`
      : toMarkdown(title, selected, options, exportedAt)
  if (!options.redactIdentifiers) return { content: raw, ext: options.format }
  const redact = createRedactor({ home: opts.home ?? homedir(), username: opts.username })
  // JSON is redacted as text: every placeholder is plain ASCII without quotes or backslashes, so it stays valid.
  return { content: redact(raw), ext: options.format }
}
