/**
 * Tool-row wording (CLAUDE.md §5, §11): the one-line summary of a tool call is worded HERE, in the UI language, from
 * the tool name, its input and the structured summary the tool recorded (`display`, for what the input does not
 * carry — a task's name, an MCP server's label). The same function serves live rows, reloaded history, the approval
 * card and the live region, so an English UI never shows the kernel's Chinese summary, and an old rollout without
 * `display` still reads as a sentence. A tool without a sentence here (a third-party tool) reads, in the Chinese UI,
 * with the kernel's own summary (it is written in Chinese); otherwise with a neutral fallback built only from names
 * and values: `mcp__server__tool` → "server · tool", anything else → its name as words plus its first short argument.
 */
import { splitOutboundBubbles, type JsonValue, type ToolSummary } from '@aiwc/protocol'
import { getLanguage, type MessageKey, type Translator } from '@/i18n'

/** What a summary is worded from (a ToolCallView or an ApprovalRequest both fit). */
export interface SummarySource {
  toolName: string
  input: JsonValue | undefined
  display?: ToolSummary
  /** The kernel's own wording (Chinese); used only where nothing better exists and the UI is Chinese. */
  summary?: string
}

/** The UI language the kernel's summaries are written in. */
const KERNEL_SUMMARY_LANGUAGE = 'zh-CN'

/** Longest free text (a message, a query, a command) quoted inside a summary. */
const TEXT_CHARS = 40
const SQL_CHARS = 60
const COMMAND_CHARS = 100
const ARG_CHARS = 60

type Params = Record<string, string | number | boolean>
type Input = Record<string, unknown>
type Formatter = (input: Input, params: Params, t: Translator) => string | undefined

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const squash = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** Tool names are snake_case; without a sentence of their own they read as words. */
export const humanizeToolName = (name: string): string => name.replace(/_/g, ' ')

const scoped =
  (one: MessageKey, many: MessageKey): Formatter =>
  (i, _p, t) => {
    const query = str(i.query)
    if (!query) return undefined
    const sessions = Array.isArray(i.sessionIds) ? i.sessionIds.length : 0
    return sessions > 0 ? t(many, { n: sessions, query }) : t(one, { query })
  }

const listOrFind =
  (list: MessageKey, find: MessageKey, fallbackLimit: number): Formatter =>
  (i, _p, t) => {
    const query = str(i.query)
    return query ? t(find, { query }) : t(list, { n: num(i.limit) ?? fallbackLimit })
  }

const named =
  (key: MessageKey, field: string): Formatter =>
  (i, p, t) => {
    const value = str(p[field]) ?? str(i[field])
    return value ? t(key, { [field]: value }) : undefined
  }

const MEDIA_KINDS = ['image', 'file', 'video', 'sticker'] as const
const SEND_KINDS = ['image', 'voice', 'file'] as const
const OFFICE_PLATFORMS = ['feishu', 'dingtalk', 'wecom'] as const

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined

const officeNames = (platform: unknown, t: Translator): { platform: string; noun: string } | undefined => {
  const p = oneOf(OFFICE_PLATFORMS, platform)
  return p ? { platform: t(`office.platform.${p}`), noun: t(`office.tableNoun.${p}`) } : undefined
}

const message =
  (to: MessageKey, here: MessageKey): Formatter =>
  (i, _p, t) => {
    // several bubbles (`---wx-next---`) read as one line; the marker itself is not the user's words
    const text = str(i.text) === undefined ? undefined : splitOutboundBubbles(str(i.text) ?? '').join(' ')
    if (!text) return undefined
    const target = str(i.to)
    return target ? t(to, { to: target, text: squash(text, TEXT_CHARS) }) : t(here, { text: squash(text, TEXT_CHARS) })
  }

/** One formatter per built-in tool; returning undefined falls back to the generic wording. */
const FORMATTERS: Record<string, Formatter> = {
  search_messages: scoped('agent.toolSummary.searchMessages', 'agent.toolSummary.searchMessagesIn'),
  semantic_search: scoped('agent.toolSummary.semanticSearch', 'agent.toolSummary.semanticSearchIn'),
  list_contacts: named('agent.toolSummary.listContacts', 'query'),
  list_sessions: listOrFind('agent.toolSummary.listSessions', 'agent.toolSummary.findSessions', 20),
  list_groups: listOrFind('agent.toolSummary.listGroups', 'agent.toolSummary.findGroups', 20),
  group_members: (i, _p, t) =>
    str(i.groupId) ? t('agent.toolSummary.groupMembers', { group: str(i.groupId) ?? '' }) : undefined,
  group_member_ranking: (i, _p, t) =>
    str(i.groupId) ? t('agent.toolSummary.groupMemberRanking', { group: str(i.groupId) ?? '' }) : undefined,
  chat_stats: (i, _p, t) => {
    const metric = str(i.metric)
    if (!metric) return undefined
    const session = str(i.sessionId)
    return session
      ? t('agent.toolSummary.chatStats', { metric, session })
      : t('agent.toolSummary.chatStatsAll', { metric })
  },
  get_context: (i, _p, t) => {
    const anchor = i.anchor && typeof i.anchor === 'object' ? (i.anchor as Input) : undefined
    const session = str(anchor?.sessionId)
    return session ? t('agent.toolSummary.getContext', { session, radius: num(i.radius) ?? 0 }) : undefined
  },
  get_timeline: (i, _p, t) => {
    const session = str(i.sessionId)
    return session ? t('agent.toolSummary.getTimeline', { session, n: num(i.limit) ?? 80 }) : undefined
  },
  transcribe_voice_message: (i, _p, t) => {
    const session = str(i.sessionId)
    return session ? t('agent.toolSummary.transcribeVoice', { session }) : undefined
  },
  query_sql: (i, _p, t) => {
    const sql = str(i.sql)
    return sql ? t('agent.toolSummary.querySql', { db: str(i.db) ?? '', sql: squash(sql, SQL_CHARS) }) : undefined
  },
  search_media: (i, _p, t) => {
    const kind = oneOf(MEDIA_KINDS, i.kind)
    if (!kind) return undefined
    const label = t(`agent.toolSummary.mediaKind.${kind}`)
    const query = str(i.query)
    return query
      ? t('agent.toolSummary.searchMedia', { kind: label, query })
      : t('agent.toolSummary.searchMediaAll', { kind: label })
  },
  remember: (i, _p, t) => {
    const file = str(i.file)
    const text = str(i.text)
    return file && text ? t('agent.toolSummary.remember', { file, text: squash(text, TEXT_CHARS) }) : undefined
  },
  recall: named('agent.toolSummary.recall', 'query'),
  forget: (i, _p, t) => {
    const file = str(i.file)
    const index = num(i.index)
    if (!file || index === undefined) return undefined
    return t('agent.toolSummary.forget', { file, index, text: squash(str(i.text) ?? '', TEXT_CHARS) })
  },
  list_memories: named('agent.toolSummary.listMemories', 'file'),
  get_relationship_profile: (i, _p, t) => {
    const contact = str(i.contactId)
    return contact ? t('agent.toolSummary.relationshipProfile', { contact }) : undefined
  },
  send_message: message('agent.toolSummary.sendMessage', 'agent.toolSummary.sendMessageHere'),
  draft_reply: message('agent.toolSummary.draftReply', 'agent.toolSummary.draftReplyHere'),
  send_media: (i, _p, t) => {
    const kind = oneOf(SEND_KINDS, i.kind) ?? 'file'
    const path = str(i.path)
    return path ? t('agent.toolSummary.sendMedia', { kind: t(`agent.toolSummary.sendKind.${kind}`), path }) : undefined
  },
  skill_view: named('agent.toolSummary.skillView', 'name'),
  skill_manage: (i, _p, t) => {
    const name = str(i.name)
    if (!name) return undefined
    return t(i.action === 'create' ? 'agent.toolSummary.skillCreate' : 'agent.toolSummary.skillUpdate', { name })
  },
  skill_delete: named('agent.toolSummary.skillDelete', 'name'),
  update_plan: (i, _p, t) => {
    if (!Array.isArray(i.steps)) return undefined
    const done = i.steps.filter((s) => s && typeof s === 'object' && (s as Input).status === 'done').length
    return t('agent.toolSummary.updatePlan', { n: i.steps.length, done })
  },
  ask_user: (i, _p, t) => {
    const question = str(i.question)
    return question ? t('agent.toolSummary.askUser', { question: squash(question, TEXT_CHARS * 2) }) : undefined
  },
  office_status: (_i, _p, t) => t('agent.toolSummary.officeStatus'),
  office_connect: (i, _p, t) => {
    const names = officeNames(i.platform, t)
    return names ? t('agent.toolSummary.officeConnect', { platform: names.platform }) : undefined
  },
  office_push_table: (i, _p, t) => {
    const names = officeNames(i.platform, t)
    if (!names) return undefined
    const rows = Array.isArray(i.rows) ? i.rows.length : 0
    if (i.target) return t('agent.toolSummary.officeAppendTable', { rows, ...names })
    const columns = Array.isArray(i.columns) ? i.columns.length : 0
    return t('agent.toolSummary.officePushTable', { rows, columns, title: str(i.title) ?? '', ...names })
  },
  shell: (i, _p, t) => {
    const command = str(i.command)
    if (!command) return undefined
    const line = squash(command, COMMAND_CHARS)
    return i.escalate === true ? t('agent.toolSummary.shellOutside', { command: line }) : `$ ${line}`
  },
  task_create: named('agent.toolSummary.taskCreate', 'name'),
  task_list: (_i, _p, t) => t('agent.toolSummary.taskList'),
  task_update: (i, p, t) => {
    const name = str(p.name) ?? str(i.name) ?? str(i.id)
    return name ? t('agent.toolSummary.taskUpdate', { name }) : undefined
  },
  task_delete: (i, p, t) => {
    const name = str(p.name) ?? str(i.id)
    return name ? t('agent.toolSummary.taskDelete', { name }) : undefined
  },
  workflow_run: (i, _p, t) => {
    const title = str(i.title)
    return title ? t('agent.toolSummary.workflow', { title }) : undefined
  },
  delegate_analysis: (i, _p, t) => {
    if (!Array.isArray(i.tasks) || i.tasks.length === 0) return undefined
    const titles = i.tasks
      .map((task) => (task && typeof task === 'object' ? str((task as Input).title) : undefined))
      .filter((title): title is string => Boolean(title))
    return t('agent.toolSummary.delegate', {
      n: i.tasks.length,
      titles: titles.join(t('agent.toolSummary.listSeparator')),
    })
  },
  // An MCP tool's row is its server and tool names plus its arguments: data, nothing to translate.
  mcp: (_i, p) => {
    const head = [str(p.server), str(p.tool)].filter(Boolean).join(' · ')
    if (!head) return undefined
    const args = str(p.args)
    return args ? `${head} ${args}` : head
  },
}

const asInput = (value: JsonValue | undefined): Input =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/** `mcp__server__tool` → "server · tool"; anything else → its name as words plus its first short argument. */
function genericSummary(toolName: string, input: Input): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName)
  const head = mcp ? `${mcp[1]} · ${mcp[2]}` : humanizeToolName(toolName)
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim()) return `${head} ${squash(value, ARG_CHARS)}`
    if (typeof value === 'number' && Number.isFinite(value)) return `${head} ${value}`
  }
  return head
}

/** The row's one-line summary in the UI language (never the kernel's wording). */
export function toolCallLabel(source: SummarySource, t: Translator): string {
  const input = asInput(source.input)
  const code = source.display?.code ?? source.toolName
  const formatter = FORMATTERS[code] ?? FORMATTERS[source.toolName]
  if (formatter) {
    try {
      const text = formatter(input, source.display?.params ?? {}, t)
      if (text) return text
    } catch {
      // a recorded input of an unexpected shape (an older build) reads with the generic wording instead
    }
  }
  const kernel = source.summary?.trim()
  return kernel && kernel !== humanizeToolName(source.toolName) && getLanguage() === KERNEL_SUMMARY_LANGUAGE
    ? kernel
    : genericSummary(source.toolName, input)
}

/** Built-in tools with a sentence of their own (tested against the catalog). */
export const WORDED_TOOLS: readonly string[] = Object.keys(FORMATTERS)
