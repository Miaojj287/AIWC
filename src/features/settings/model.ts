/**
 * Settings page model: the five pages, their nav grouping and header copy (DESIGN-SPEC §2).
 * Pure data — the search index and the Tab both derive from it.
 */
import type { CommandMap } from '@/app/commands'

export type SettingsPage = NonNullable<CommandMap['tab.openSettings']['page']>

export const SETTINGS_PAGES: readonly SettingsPage[] = ['general', 'account', 'ai', 'memory', 'about']

export interface SettingsPageMeta {
  /** Nav label. */
  label: string
  /** Page title (20px). */
  title: string
  /** One-line description under the title (weak). */
  description: string
  /** lucide icon name used by the nav. */
  icon: 'sliders-horizontal' | 'user-round' | 'cpu' | 'book-open' | 'info'
}

export const PAGE_META: Record<SettingsPage, SettingsPageMeta> = {
  general: { label: '常规', title: '常规', description: '外观与启动行为', icon: 'sliders-horizontal' },
  account: { label: '账号', title: '账号管理', description: '当前微信账号、数据库连接与解密密钥', icon: 'user-round' },
  ai: { label: 'AI 接入', title: 'AI 接入', description: 'Agent 使用的大模型，以及语音转文字的转写方式', icon: 'cpu' },
  memory: { label: '记忆', title: 'AI 记忆', description: 'Agent 跨会话记住的事实、你的画像与工作规则，均为本地 Markdown 文件', icon: 'book-open' },
  about: { label: '版本与支持', title: '版本与支持', description: '版本信息、协议与日志', icon: 'info' },
}

export interface NavGroup {
  id: string
  label: string
  pages: SettingsPage[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'common', label: '通用', pages: ['general', 'account'] },
  { id: 'ai', label: 'AI', pages: ['ai', 'memory'] },
  { id: 'about', label: '关于', pages: ['about'] },
]

export const isSettingsPage = (v: unknown): v is SettingsPage => typeof v === 'string' && (SETTINGS_PAGES as readonly string[]).includes(v)

/** Tab state stored on the settings TabDescriptor. */
export interface SettingsTabState {
  page?: SettingsPage
  highlight?: string
}

export const SETTINGS_TAB = { kind: 'settings', objectId: 'settings', title: '设置' } as const
