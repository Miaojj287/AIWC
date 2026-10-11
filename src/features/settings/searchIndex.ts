/**
 * Settings search (DESIGN-SPEC §2): the nav SearchBox lists matching rows with their page / group
 * label; picking one jumps to the page and highlights the row for 2 s. Pure — no React, no bridge.
 * Row copy lives in settings.nav.search.rows (CLAUDE.md §11): a query matches the title / keywords /
 * group / description in every UI language, while titles and locations display in the current one.
 */
import { LANGUAGES, translate, type Messages } from '@aiwc/i18n'
import { t, type MessageKey } from '@/i18n'
import { PAGE_META, type SettingsPage } from './model'

type RowCopy = Messages['settings']['nav']['search']['rows']
/** `'general.theme' | 'account.dbKey' | …` — a row id doubles as the path of its copy under settings.nav.search.rows. */
type RowId = { [P in keyof RowCopy & string]: `${P}.${keyof RowCopy[P] & string}` }[keyof RowCopy & string]

export interface SettingsRow {
  /** Stable id; also the `highlight` value carried by tab.openSettings. */
  id: string
  page: SettingsPage
  /** Catalog keys behind the fields below; `keywords` is a comma-separated list of extra search terms (synonyms, English names). */
  keys: { group: MessageKey; title: MessageKey; description: MessageKey; keywords: MessageKey }
  /** Section title on the page (e.g. 外观 / 数据库配置) — this and the fields below read the current language. */
  readonly group: string
  readonly title: string
  readonly description?: string
}

/** `group`: the section's own key on its page when it has one, else a settings.nav.search.groups key. */
function row(id: RowId, page: SettingsPage, group: MessageKey): SettingsRow {
  const keys = {
    group,
    title: `settings.nav.search.rows.${id}.title`,
    description: `settings.nav.search.rows.${id}.description`,
    keywords: `settings.nav.search.rows.${id}.keywords`,
  } as const
  return {
    id,
    page,
    keys,
    get group() {
      return t(keys.group)
    },
    get title() {
      return t(keys.title)
    },
    get description() {
      return t(keys.description)
    },
  }
}

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  // 常规
  row('general.appearance', 'general', 'settings.general.sections.appearance'),
  row('general.theme', 'general', 'settings.general.sections.appearance'),
  row('general.transparency', 'general', 'settings.general.sections.appearance'),
  row('general.layout', 'general', 'settings.general.sections.preferences'),
  row('general.language', 'general', 'settings.general.sections.preferences'),
  row('general.launchAtLogin', 'general', 'settings.general.sections.preferences'),
  row('general.sendKey', 'general', 'settings.general.sections.preferences'),
  row('general.notifications', 'general', 'settings.general.sections.preferences'),
  row('general.closeBehavior', 'general', 'settings.general.sections.preferences'),
  // 账号
  row('account.current', 'account', 'settings.nav.search.groups.currentAccount'),
  row('account.dbKey', 'account', 'settings.account.sections.keys'),
  row('account.dbRoot', 'account', 'settings.account.sections.dirs'),
  row('account.verify', 'account', 'settings.account.sections.dirs'),
  row('account.cacheDir', 'account', 'settings.account.sections.dirs'),
  row('account.imageKeys', 'account', 'settings.account.sections.keys'),
  row('account.mobile', 'account', 'mobile.settings.title'),
  row('account.mobileRemote', 'account', 'mobile.settings.remoteTitle'),
  // 数据
  row('data.usage', 'data', 'settings.data.sections.usage'),
  row('data.plaintext', 'data', 'settings.data.sections.clean'),
  row('data.media', 'data', 'settings.data.sections.clean'),
  row('data.logs', 'data', 'settings.data.sections.clean'),
  row('data.wipe', 'data', 'settings.data.sections.danger'),
  // 宠物
  row('pets.current', 'pets', 'settings.pets.sections.current'),
  row('pets.enabled', 'pets', 'settings.pets.sections.current'),
  row('pets.bubbles', 'pets', 'settings.pets.sections.current'),
  row('pets.motion', 'pets', 'settings.pets.sections.current'),
  row('pets.idleFlair', 'pets', 'settings.pets.sections.current'),
  row('pets.size', 'pets', 'settings.pets.sections.current'),
  row('pets.statusRunning', 'pets', 'settings.pets.sections.status'),
  row('pets.statusDone', 'pets', 'settings.pets.sections.status'),
  row('pets.statusUnread', 'pets', 'settings.pets.sections.status'),
  row('pets.installed', 'pets', 'settings.pets.sections.installed'),
  row('pets.catalog', 'pets', 'settings.pets.sections.catalog'),
  // AI 接入
  row('ai.providers', 'ai', 'settings.ai.page.agentSection'),
  row('ai.apiKey', 'ai', 'settings.ai.page.agentSection'),
  row('ai.models', 'ai', 'settings.ai.page.agentSection'),
  row('ai.status', 'ai', 'settings.ai.page.agentSection'),
  row('ai.defaultModel', 'ai', 'settings.ai.page.agentSection'),
  row('ai.permissions', 'ai', 'settings.ai.permissions.title'),
  row('ai.jev', 'ai', 'settings.ai.jev.section'),
  row('ai.jevKey', 'ai', 'settings.ai.jev.section'),
  row('ai.jevTest', 'ai', 'settings.ai.jev.section'),
  row('ai.sttMode', 'ai', 'settings.ai.stt.section'),
  row('ai.sttLocal', 'ai', 'settings.ai.stt.section'),
  row('ai.sttOnline', 'ai', 'settings.ai.stt.section'),
  row('ai.proxy', 'ai', 'settings.network.section'),
  row('ai.proxyBypass', 'ai', 'settings.network.section'),
  // 用量与记录
  row('usage.overview', 'usage', 'settings.usage.sections.overview'),
  row('usage.calls', 'usage', 'settings.usage.sections.calls'),
  row('usage.recordContent', 'usage', 'settings.usage.sections.calls'),
  // 记忆
  row('memory.files', 'memory', 'settings.memory.sections.files'),
  row('memory.editor', 'memory', 'settings.nav.search.groups.editor'),
  row('memory.review', 'memory', 'settings.memory.review.section'),
  row('memory.autoWrite', 'memory', 'settings.memory.sections.policy'),
  row('memory.confirmBeforeWrite', 'memory', 'settings.memory.sections.policy'),
  row('memory.maxEntries', 'memory', 'settings.memory.sections.policy'),
  row('memory.clear', 'memory', 'settings.memory.sections.policy'),
  // 技能
  row('skills.list', 'skills', 'settings.skills.section'),
  // 每日待办
  row('todo.enabled', 'todo', 'settings.todo.sections.main'),
  row('todo.sources', 'todo', 'settings.todo.sections.scope'),
  row('todo.maxMessages', 'todo', 'settings.todo.sections.scope'),
  row('todo.schedule', 'todo', 'settings.todo.sections.schedule'),
  row('todo.model', 'todo', 'settings.todo.sections.model'),
  // 扩展
  row('extensions.mcp', 'extensions', 'settings.extensions.sections.mcp'),
  row('extensions.hooks', 'extensions', 'settings.extensions.sections.hooks'),
  // 版本与支持
  row('about.update', 'about', 'settings.nav.search.groups.version'),
  row('about.terms', 'about', 'settings.nav.search.groups.version'),
  row('about.privacy', 'about', 'settings.nav.search.groups.version'),
  row('about.logs', 'about', 'settings.nav.search.groups.version'),
]

export interface SearchHit {
  row: SettingsRow
  score: number
  /** e.g. 'AI 接入 · Agent 模型' */
  location: string
}

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

/** One message in every UI language, normalized — search is language-independent. */
const variants = (key: MessageKey): string[] => LANGUAGES.map((language) => normalize(translate(language, key)))

/** Split a query into tokens (whitespace-separated, CJK kept as one token). */
export function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Score a single row for one token: title prefix 6, title contains 5, keyword 4, group 2, description 1. */
export function scoreRow(row: SettingsRow, token: string): number {
  const titles = variants(row.keys.title)
  if (titles.some((title) => title.startsWith(token))) return 6
  if (titles.some((title) => title.includes(token))) return 5
  if (variants(row.keys.keywords).some((list) => list.split(/[,，、]/).some((k) => k.includes(token)))) return 4
  if (variants(row.keys.group).some((group) => group.includes(token))) return 2
  if (variants(row.keys.description).some((description) => description.includes(token))) return 1
  return 0
}

export function locationOf(row: SettingsRow): string {
  return `${t(PAGE_META[row.page].label)} · ${row.group}`
}

/**
 * Every token must match somewhere (AND); rows are ranked by the sum of token scores, then by
 * page order, so results feel deterministic. Empty query → no hits.
 */
export function searchSettings(query: string, rows: readonly SettingsRow[] = SETTINGS_ROWS, limit = 8): SearchHit[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const hits: SearchHit[] = []
  for (const row of rows) {
    let total = 0
    let ok = true
    for (const token of tokens) {
      const s = scoreRow(row, token)
      if (s === 0) {
        ok = false
        break
      }
      total += s
    }
    if (ok) hits.push({ row, score: total, location: locationOf(row) })
  }
  const order = new Map(rows.map((r, i) => [r.id, i]))
  hits.sort((a, b) => b.score - a.score || (order.get(a.row.id) ?? 0) - (order.get(b.row.id) ?? 0))
  return hits.slice(0, limit)
}
