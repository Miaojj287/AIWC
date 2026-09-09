/**
 * Where WeChat 4.x keeps account data:
 *   macOS   ~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/<version>/<account>/
 *           ~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<account>/
 *   Windows %USERPROFILE%\Documents\xwechat_files\<account>\  (or the legacy "WeChat Files")
 * The best root is the one whose accounts were modified most recently. Pure scoring, tested on temp trees.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { accountModifiedTime, isAccountDir } from '../wcdb/dbFiles'

export interface DbRootCandidate {
  path: string
  accountCount: number
  latestModified: number
  score: number
}

export interface RootEnv {
  platform: NodeJS.Platform
  home: string
  appData?: string
  userProfile?: string
}

export function currentRootEnv(): RootEnv {
  return {
    platform: process.platform,
    home: homedir(),
    appData: process.env.APPDATA,
    userProfile: process.env.USERPROFILE,
  }
}

export function isMacVersionDir(name: string): boolean {
  return /^\d+\.\d+b\d+\.\d+/.test(name) || /^\d+\.\d+\.\d+/.test(name)
}

/** Directory names that are never accounts. */
export function isPotentialAccountName(name: string): boolean {
  const lower = name.toLowerCase()
  if (!lower || lower.startsWith('.')) return false
  return !['all', 'applet', 'backup', 'wmpf', 'app_data', 'system', 'temp', 'cache', 'xwechat_files', 'all_users'].some((p) => lower === p || lower.startsWith(p))
}

function safeReadDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/** Account directory names under a root, most recently modified first. */
export function listAccountDirs(root: string): string[] {
  const accounts = safeReadDirNames(root).filter((name) => isPotentialAccountName(name) && isAccountDir(join(root, name)))
  return accounts.sort((a, b) => accountModifiedTime(join(root, b)) - accountModifiedTime(join(root, a)) || a.localeCompare(b))
}

/** Static candidate roots for the platform (existence not checked). */
export function defaultRootCandidates(env: RootEnv): string[] {
  const roots: string[] = []
  if (env.platform === 'darwin') {
    const container = join(env.home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data')
    const appSupport = join(container, 'Library', 'Application Support', 'com.tencent.xinWeChat')
    for (const entry of safeReadDirNames(appSupport)) {
      if (isMacVersionDir(entry)) roots.push(join(appSupport, entry))
    }
    roots.push(join(container, 'Documents', 'xwechat_files'), join(env.home, 'Documents', 'xwechat_files'), join(env.home, 'Documents', 'WeChat Files'))
    return roots
  }
  const documents = join(env.userProfile || env.home, 'Documents')
  roots.push(join(documents, 'xwechat_files'), join(documents, 'WeChat Files'))
  return roots
}

function rootBonus(root: string, platform: NodeJS.Platform): number {
  const name = basename(root).toLowerCase()
  if (platform === 'darwin' && isMacVersionDir(name)) return 50_000
  if (name === 'xwechat_files') return 30_000
  if (name === 'wechat files') return 20_000
  return 0
}

/** Score existing roots: version-dir bonus + accounts × 10 000 + latest mtime. */
export function scoreRootCandidates(paths: string[], platform: NodeJS.Platform): DbRootCandidate[] {
  const seen = new Set<string>()
  const candidates: DbRootCandidate[] = []
  for (const raw of paths) {
    const normalized = String(raw || '').replace(/[\\/]+$/, '')
    if (!normalized || seen.has(normalized) || !existsSync(normalized)) continue
    seen.add(normalized)
    if (isAccountDir(normalized)) {
      const latestModified = accountModifiedTime(normalized)
      candidates.push({ path: normalized, accountCount: 1, latestModified, score: 1_000_000 + latestModified })
      continue
    }
    const accounts = listAccountDirs(normalized)
    if (accounts.length === 0) continue
    let latestModified = 0
    for (const account of accounts) latestModified = Math.max(latestModified, accountModifiedTime(join(normalized, account)))
    candidates.push({
      path: normalized,
      accountCount: accounts.length,
      latestModified,
      score: rootBonus(normalized, platform) + accounts.length * 10_000 + latestModified,
    })
  }
  return candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
}

/** Best-guess db root for the current machine, or undefined when nothing exists. */
export function detectDbRoot(env: RootEnv = currentRootEnv()): DbRootCandidate | undefined {
  return scoreRootCandidates(defaultRootCandidates(env), env.platform)[0]
}

/** Default path to show in the UI when nothing was detected. */
export function defaultDbRootHint(env: RootEnv = currentRootEnv()): string {
  const candidates = defaultRootCandidates(env)
  return candidates[0] ?? join(env.home, 'Documents', 'xwechat_files')
}
