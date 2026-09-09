/**
 * Settings search (DESIGN-SPEC §2): the nav SearchBox lists matching rows with their page / group
 * label; picking one jumps to the page and highlights the row for 2 s. Pure — no React, no bridge.
 */
import { PAGE_META, type SettingsPage } from './model'

export interface SettingsRow {
  /** Stable id; also the `highlight` value carried by tab.openSettings. */
  id: string
  page: SettingsPage
  /** Section title on the page (e.g. 外观 / 数据库配置). */
  group: string
  title: string
  description?: string
  /** Extra search terms (synonyms, English names). */
  keywords?: string[]
}

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  // 常规
  { id: 'general.theme', page: 'general', group: '外观', title: '主题模式', description: '选择界面配色，切换后立即生效', keywords: ['theme', '深色', '浅色', '跟随系统', '外观'] },
  { id: 'general.launchAtLogin', page: 'general', group: '启动', title: '开机自启', description: '登录系统后在后台自动启动 AIWC', keywords: ['launch', 'login', '自启动', '启动'] },
  { id: 'general.closeBehavior', page: 'general', group: '启动', title: '关闭窗口时', description: '点击窗口关闭按钮后的行为', keywords: ['close', '退出', '最小化', '菜单栏', '每次询问'] },
  // 账号
  { id: 'account.current', page: 'account', group: '当前账号', title: '切换账号', description: '本机检测到的所有 wxid 及验证状态', keywords: ['wxid', 'account', '账号', '重新扫描'] },
  { id: 'account.dbKey', page: 'account', group: '解密密钥', title: '数据库解密密钥', description: '64 位十六进制密钥，用于验证当前账号数据库连接', keywords: ['key', '密钥', 'hex', '自动获取', '手动输入'] },
  { id: 'account.dbRoot', page: 'account', group: '目录与账号验证', title: '数据库根目录', description: '微信账号数据所在目录，通常是包含 db_storage 的目录', keywords: ['path', 'db_storage', '目录', '路径'] },
  { id: 'account.verify', page: 'account', group: '目录与账号验证', title: '账号验证', description: '确认 wxid 与数据库目录匹配', keywords: ['verify', '验证', '测试连接'] },
  { id: 'account.cacheDir', page: 'account', group: '目录与账号验证', title: '缓存目录', description: '可选，留空时使用默认目录', keywords: ['cache', '缓存', '目录'] },
  { id: 'account.imageKeys', page: 'account', group: '解密密钥', title: '图片解密密钥', description: 'XOR / AES 密钥，优先走 kvcomm + wxid 验真', keywords: ['xor', 'aes', 'image', '图片', '密钥'] },
  // AI 接入
  { id: 'ai.providers', page: 'ai', group: 'Agent 模型', title: '模型厂商', description: 'DeepSeek / Kimi / GLM / Qwen / OpenAI / Anthropic / Ollama 等，或自定义接口', keywords: ['provider', 'vendor', 'deepseek', 'kimi', 'glm', 'qwen', 'minimax', 'hunyuan', 'openai', 'anthropic', 'gemini', 'ollama', '厂商', '接入', '自定义'] },
  { id: 'ai.apiKey', page: 'ai', group: 'Agent 模型', title: 'API Key', description: '接入厂商时填写，仅保存在本机钥匙串，不会上传', keywords: ['key', 'api key', '密钥', 'token', '编辑 key'] },
  { id: 'ai.models', page: 'ai', group: 'Agent 模型', title: '模型列表', description: '启用 / 停用模型，设置推理强度、快速模式与上下文用量', keywords: ['model', '模型', '启用', '推理强度', '快速', '上下文', '拉取模型'] },
  { id: 'ai.status', page: 'ai', group: 'Agent 模型', title: '测试连接', description: '延迟、是否支持工具调用', keywords: ['test', 'status', '测试连接', '连接', '断开'] },
  { id: 'ai.defaultModel', page: 'ai', group: 'Agent 模型', title: '默认模型', description: '新建 Agent 会话时使用的模型', keywords: ['default', 'model', '默认'] },
  { id: 'ai.sttMode', page: 'ai', group: '语音转文字', title: '转写模式', description: '本地模式不上传音频；在线模式通过兼容接口转写', keywords: ['stt', 'whisper', '语音', '转文字', '本地', '在线'] },
  { id: 'ai.sttLocal', page: 'ai', group: '语音转文字', title: '本地模型', description: '下载、删除与设为默认', keywords: ['stt', '语音', '本地模型', '下载', '训练参数'] },
  { id: 'ai.sttOnline', page: 'ai', group: '语音转文字', title: '在线转写接口', description: '与 Agent 模型表单同构：提供商、URL、Key、模型 ID', keywords: ['stt', '在线', '转写', '接口', 'transcription'] },
  // 记忆
  { id: 'memory.files', page: 'memory', group: '记忆文件', title: '记忆文件', description: 'MEMORY / USER / SOUL / AGENTS 四个 Markdown 文件', keywords: ['memory', 'markdown', '记忆', '画像', '人格', '规则'] },
  { id: 'memory.editor', page: 'memory', group: '编辑', title: '编辑记忆文件', description: '内嵌 Markdown 编辑器，保存或重置', keywords: ['edit', '编辑', '保存', '重置'] },
  { id: 'memory.autoWrite', page: 'memory', group: '记忆策略', title: '自动写入记忆', description: '会话结束时由 Agent 提炼要点写入 MEMORY.md', keywords: ['auto', '自动写入', '策略'] },
  { id: 'memory.confirmBeforeWrite', page: 'memory', group: '记忆策略', title: '写入前需要确认', description: '关闭后 Agent 可直接修改记忆文件', keywords: ['confirm', '确认', '策略'] },
  { id: 'memory.maxEntries', page: 'memory', group: '记忆策略', title: '记忆条数上限', description: '超出后按最久未使用淘汰', keywords: ['limit', '上限', '条数'] },
  { id: 'memory.clear', page: 'memory', group: '记忆策略', title: '清空全部记忆', description: '删除当前文件中的所有条目', keywords: ['clear', '清空', '删除'] },
  // 版本与支持
  { id: 'about.update', page: 'about', group: '版本', title: '检查更新', description: '查看当前版本是否可更新', keywords: ['update', '更新', '版本'] },
  { id: 'about.terms', page: 'about', group: '版本', title: '用户服务协议', description: '查看《AIWC 用户服务协议》', keywords: ['terms', '协议'] },
  { id: 'about.privacy', page: 'about', group: '版本', title: '隐私政策', description: '查看《AIWC 隐私政策》', keywords: ['privacy', '隐私'] },
  { id: 'about.logs', page: 'about', group: '版本', title: '日志', description: '导出日志，便于问题反馈', keywords: ['log', '日志', '导出'] },
]

export interface SearchHit {
  row: SettingsRow
  score: number
  /** e.g. 'AI 接入 · Agent 模型' */
  location: string
}

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

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
  const title = normalize(row.title)
  if (title.startsWith(token)) return 6
  if (title.includes(token)) return 5
  if ((row.keywords ?? []).some((k) => normalize(k).includes(token))) return 4
  if (normalize(row.group).includes(token)) return 2
  if (row.description && normalize(row.description).includes(token)) return 1
  return 0
}

export function locationOf(row: SettingsRow): string {
  return `${PAGE_META[row.page].label} · ${row.group}`
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
