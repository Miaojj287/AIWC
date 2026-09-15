/**
 * @aiwc/i18n — the one place UI copy lives (CLAUDE.md §11). Two catalogs — zh-CN is the reference,
 * en-US mirrors it key for key (tsc enforces the shape, parity.test.ts the placeholders) — a dotted-key
 * `translate`, and helpers the renderer (src/i18n) and the main process (electron/main/i18n.ts) wrap.
 *
 * Adding copy = adding the same key to BOTH catalogs in the same change.
 */
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@aiwc/protocol'
import type { Messages } from './locales/zh-CN'

export type { MessageParams } from './core'
export { leafKeys, lookup, placeholdersOf } from './core'
export type { Language, Messages }
export { DEFAULT_LANGUAGE, LANGUAGES }
export {
  LANGUAGE_NAMES,
  catalogs,
  createTranslator,
  isLanguage,
  resolveLanguage,
  translate,
  type MessageKey,
  type Translator,
} from './translate'
export { localizeKnown } from './known'
