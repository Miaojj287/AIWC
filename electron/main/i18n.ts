/**
 * Main-process binding for @aiwc/i18n: menu labels, native dialog buttons, toasts pushed from main and
 * the user-facing errors IPC handlers throw. index.ts sets the language from config and re-applies it
 * on every config change; `t` reads it on each call, so handlers registered once stay current.
 *
 * Model prompts and log lines are NOT copy — they never go through here (CLAUDE.md §11).
 */
import { DEFAULT_LANGUAGE, createTranslator, type Language, type Translator } from '@aiwc/i18n'

export type { Language, MessageKey, MessageParams, Translator } from '@aiwc/i18n'

let current: Language = DEFAULT_LANGUAGE

export function setMainLanguage(language: Language): void {
  current = language
}

export function mainLanguage(): Language {
  return current
}

export const t: Translator = createTranslator(() => current)
