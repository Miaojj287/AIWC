/**
 * File access for the composition root: the validated custom WeChat cache dir, the renderer's file allow-list and
 * the app's protected stores (paths.ts protectedDataPaths).
 *
 * account.cacheDir is renderer-writable (config:set), so it is never trusted as-is: the substrate only gets it when
 * it is an absolute, non-root, non-home path, and it becomes a file allow-list root only at startup and only when
 * it already exists as a directory. Later changes go through app:pickDirectory (dialog result → root) + the
 * config:set validation, never via config.subscribe.
 */
import { foreignAccountPaths } from './services/accountProfiles'
import { homedir } from 'node:os'
import type { AppConfig } from '@aiwc/protocol'
import type { Logger } from './log'
import { defaultAllowedRoots, protectedDataPaths, substrateCacheDir, type AppPaths } from './paths'
import { customCacheDir, isDirectorySync, validateCacheDir } from './security/cacheDirPolicy'
import { createAllowList, type AllowList } from './security/pathAllowList'

export interface FileAccess {
  /** The account's custom cache dir when valid; read per call (the setting can change while the app runs). */
  cacheDirOverride(): string | undefined
  allowList: AllowList
  /** protectedDataPaths for the current custom cache dir; read per call for the same reason. */
  protectedPaths(): string[]
}

export function composeFileAccess(deps: {
  paths: AppPaths
  config: () => AppConfig
  log: Pick<Logger, 'warn'>
  home?: string
}): FileAccess {
  const home = deps.home ?? homedir()
  const cacheDirOverride = (): string | undefined => {
    const raw = customCacheDir(deps.config().account.cacheDir)
    if (!raw) return undefined
    const verdict = validateCacheDir(raw, { home })
    if (!verdict.ok) {
      deps.log.warn('ignoring account.cacheDir', { cacheDir: raw, reason: verdict.reason })
      return undefined
    }
    return verdict.dir
  }
  const startupCacheDir = (() => {
    const dir = cacheDirOverride()
    if (!dir) return undefined
    const verdict = validateCacheDir(dir, { home, isDirectory: isDirectorySync })
    if (!verdict.ok)
      deps.log.warn('account.cacheDir not added to file allow-list', { cacheDir: dir, reason: verdict.reason })
    return verdict.ok ? substrateCacheDir(deps.paths, verdict.dir) : undefined
  })()
  return {
    cacheDirOverride,
    allowList: createAllowList(defaultAllowedRoots(deps.paths, { cacheDir: startupCacheDir }), {
      home,
      denied: () => foreignAccountPaths(deps.paths),
    }),
    protectedPaths: () => [...protectedDataPaths(deps.paths, cacheDirOverride()), ...foreignAccountPaths(deps.paths)],
  }
}
