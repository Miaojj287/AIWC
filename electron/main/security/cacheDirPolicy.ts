/**
 * Policy for `account.cacheDir`. The value is renderer-writable through config:set, and the
 * renderer renders untrusted WeChat content, so it must never be able to turn a config write into a
 * new allow-list root. A custom cache dir is accepted only when it is an absolute path that is not a
 * filesystem root or the home directory, and (when an allow-list is given) already lies inside the
 * allow-list — i.e. it was picked through the native dialog this session or sits under the data root.
 */
import { isAbsolute, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { isForbiddenRoot, type AllowList } from './pathAllowList'
import { t } from '../i18n'

export interface CacheDirPolicyOptions {
  /** Injected for tests; defaults to os.homedir() inside isForbiddenRoot. */
  home?: string
  /** When given, the directory must already be allowed (no privilege escalation). */
  allowList?: Pick<AllowList, 'isAllowed'>
  /** When given, the directory must exist as a directory (startup root validation). */
  isDirectory?: (path: string) => boolean
}

export type CacheDirVerdict = { ok: true; dir: string } | { ok: false; reason: string }

/** Getters: each read resolves in the current UI language (the verdict reason is shown in settings). */
export const CACHE_DIR_ERRORS = {
  get notAbsolute() {
    return t('main.files.cacheDirNotAbsolute')
  },
  get forbiddenRoot() {
    return t('main.files.cacheDirForbiddenRoot')
  },
  get notAllowed() {
    return t('main.files.cacheDirNotAllowed')
  },
  get missing() {
    return t('main.files.cacheDirMissing')
  },
}

export function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Normalise the renderer's value: empty / whitespace means "use the default directory". */
export function customCacheDir(raw: unknown): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed ? trimmed : undefined
}

export function validateCacheDir(raw: string, opts: CacheDirPolicyOptions = {}): CacheDirVerdict {
  if (typeof raw !== 'string' || raw.includes('\0') || !isAbsolute(raw))
    return { ok: false, reason: CACHE_DIR_ERRORS.notAbsolute }
  const dir = resolve(raw)
  if (isForbiddenRoot(dir, opts.home)) return { ok: false, reason: CACHE_DIR_ERRORS.forbiddenRoot }
  if (opts.allowList && !opts.allowList.isAllowed(dir)) return { ok: false, reason: CACHE_DIR_ERRORS.notAllowed }
  if (opts.isDirectory && !opts.isDirectory(dir)) return { ok: false, reason: CACHE_DIR_ERRORS.missing }
  return { ok: true, dir }
}
