/**
 * Catalog registry and key lookup. Split from index.ts so known.ts can use it without a cycle.
 */
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@aiwc/protocol'
import { formatMessage, lookup, type DotPaths, type MessageParams } from './core'
import { zhCN, type Messages } from './locales/zh-CN'
import { enUS } from './locales/en-US'

/** `'common.cancel' | 'chat.header.export' | …` — every leaf of the reference catalog. */
export type MessageKey = DotPaths<Messages>
export type Translator = (key: MessageKey, params?: MessageParams) => string

export const catalogs: Readonly<Record<Language, Messages>> = { 'zh-CN': zhCN, 'en-US': enUS }

/** Native names, deliberately untranslated: whoever cannot read the current UI must still find their own language. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { 'zh-CN': '简体中文', 'en-US': 'English' }

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** Map a BCP 47 tag (`navigator.language`, `app.getLocale()`) onto a supported language. */
export function resolveLanguage(tag: string | null | undefined): Language {
  const lower = (tag ?? '').toLowerCase()
  if (!lower) return DEFAULT_LANGUAGE
  if (isLanguage(tag)) return tag
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('en')) return 'en-US'
  return DEFAULT_LANGUAGE
}

/**
 * Resolve `key` in `language`, falling back to the reference catalog and finally to the key itself,
 * so a missing translation shows up as a visible key rather than a crash or a blank. Static keys can't
 * go missing (tsc checks them); this only guards keys assembled at runtime.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const template = lookup(catalogs[language] ?? zhCN, key) ?? lookup(zhCN, key)
  if (template === undefined) return key
  return params || template.includes('{') ? formatMessage(template, params ?? {}, language) : template
}

/** A translator bound to a language getter — `getLanguage` is read on every call so switches apply immediately. */
export function createTranslator(getLanguage: () => Language): Translator {
  return (key, params) => translate(getLanguage(), key, params)
}
