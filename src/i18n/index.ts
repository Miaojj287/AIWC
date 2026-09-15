/**
 * Renderer binding for @aiwc/i18n (CLAUDE.md §11). The current language lives in a tiny zustand store
 * that configStore feeds from `general.language` on hydrate / set / rollback.
 *
 *   const t = useT()                                   // components: re-render on a language switch
 *   t('chat.header.export')                            // plain key
 *   t('chat.header.count', { n: total })               // params / plural / select (packages/i18n/src/core.ts)
 *   <Trans k="kit.dialog.typeToConfirm" params={{ word: <b>{word}</b> }} />   // params that are elements
 *   import { t } from '@/i18n'                         // stores, models, command handlers
 *
 * The module-level `t` reads the language on every call: call it where the text is needed, never in
 * a module-scope constant (that would freeze the language at import time). Tables of labels store
 * `MessageKey`s and are resolved with `t()` at render.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import {
  DEFAULT_LANGUAGE,
  createTranslator,
  isLanguage,
  localizeKnown,
  resolveLanguage,
  translate,
  type Language,
  type MessageKey,
  type MessageParams,
  type Translator,
} from '@aiwc/i18n'

export type { Language, MessageKey, Translator } from '@aiwc/i18n'
export { LANGUAGES, LANGUAGE_NAMES } from '@aiwc/i18n'

const STORAGE_KEY = 'aiwc.language'

interface LanguageState {
  language: Language
}

export const useLanguageStore = create<LanguageState>(() => ({ language: DEFAULT_LANGUAGE }))

export function getLanguage(): Language {
  return useLanguageStore.getState().language
}

/** Applied by configStore on hydrate / set / rollback; stamps `<html lang>` and remembers it for the next boot screen. */
export function setLanguage(language: Language): void {
  if (useLanguageStore.getState().language !== language) useLanguageStore.setState({ language })
  if (typeof document !== 'undefined') document.documentElement.lang = language
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* storage unavailable (tests, privacy mode) */
  }
}

/**
 * Language for the boot screen, before the config is read: the last one used, else the OS language.
 * Only main.tsx calls this — tests keep the zh-CN default.
 */
export function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    /* storage unavailable */
  }
  return resolveLanguage(typeof navigator === 'undefined' ? undefined : navigator.language)
}

/** Translator for non-React code. Reads the current language at call time. */
export const t: Translator = createTranslator(getLanguage)

/** Translator for components: re-renders the caller when the language changes. Put `t` in hook deps. */
export function useT(): Translator {
  const language = useLanguageStore((s) => s.language)
  return useMemo(() => (key: MessageKey, params?: MessageParams) => translate(language, key, params), [language])
}

/**
 * System text that a shared package computes in the renderer (e.g. protocol's `validateWechatKey`
 * errors) → current UI language. Text from main is already localized at the IPC boundary.
 */
export function localizeKnownText<T extends string | undefined>(text: T): T {
  return localizeKnown(text, getLanguage()) as T
}

export function useLanguage(): Language {
  return useLanguageStore((s) => s.language)
}

/** Reset to the default language (tests). */
export function __resetLanguageForTests(): void {
  useLanguageStore.setState({ language: DEFAULT_LANGUAGE })
}

export { Trans } from './Trans'
