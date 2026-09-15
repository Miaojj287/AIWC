/**
 * Settings page model: the five pages, their nav grouping and header copy (DESIGN-SPEC §2).
 * Pure data — the search index and the Tab both derive from it.
 */
import type { CommandMap } from '@/app/commands'
import { t, type MessageKey } from '@/i18n'

export type SettingsPage = NonNullable<CommandMap['tab.openSettings']['page']>

export const SETTINGS_PAGES: readonly SettingsPage[] = ['general', 'account', 'pets', 'ai', 'memory', 'about']

export interface SettingsPageMeta {
  /** Nav label. */
  label: MessageKey
  /** Page title (20px). */
  title: MessageKey
  /** One-line description under the title (weak). */
  description: MessageKey
  /** lucide icon name used by the nav. */
  icon: 'sliders-horizontal' | 'user-round' | 'paw-print' | 'cpu' | 'book-open' | 'info'
}

export const PAGE_META: Record<SettingsPage, SettingsPageMeta> = {
  general: {
    label: 'settings.nav.pages.general.label',
    title: 'settings.nav.pages.general.title',
    description: 'settings.nav.pages.general.description',
    icon: 'sliders-horizontal',
  },
  account: {
    label: 'settings.nav.pages.account.label',
    title: 'settings.nav.pages.account.title',
    description: 'settings.nav.pages.account.description',
    icon: 'user-round',
  },
  ai: {
    label: 'settings.nav.pages.ai.label',
    title: 'settings.nav.pages.ai.title',
    description: 'settings.nav.pages.ai.description',
    icon: 'cpu',
  },
  pets: {
    label: 'settings.nav.pages.pets.label',
    title: 'settings.nav.pages.pets.title',
    description: 'settings.nav.pages.pets.description',
    icon: 'paw-print',
  },
  memory: {
    label: 'settings.nav.pages.memory.label',
    title: 'settings.nav.pages.memory.title',
    description: 'settings.nav.pages.memory.description',
    icon: 'book-open',
  },
  about: {
    label: 'settings.nav.pages.about.label',
    title: 'settings.nav.pages.about.title',
    description: 'settings.nav.pages.about.description',
    icon: 'info',
  },
}

export interface NavGroup {
  id: string
  label: MessageKey
  pages: SettingsPage[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'common', label: 'settings.nav.groups.common', pages: ['general', 'account', 'pets'] },
  { id: 'ai', label: 'settings.nav.groups.ai', pages: ['ai', 'memory'] },
  { id: 'about', label: 'settings.nav.groups.about', pages: ['about'] },
]

export const isSettingsPage = (v: unknown): v is SettingsPage =>
  typeof v === 'string' && (SETTINGS_PAGES as readonly string[]).includes(v)

/** Tab state stored on the settings TabDescriptor. */
export interface SettingsTabState {
  page?: SettingsPage
  highlight?: string
}

/** `title` is read when the descriptor is spread into tabs.open; the strip shows the title registered in index.ts. */
export const SETTINGS_TAB = {
  kind: 'settings',
  objectId: 'settings',
  get title(): string {
    return t('settings.nav.tabTitle')
  },
} as const
