import { t } from '../i18n'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { AppConfigSchema, type AppConfig } from '@aiwc/protocol'
import { atomicWriteJson, createConfigService } from '../config/configService'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
import { ensureDirs, type AppPaths } from '../paths'

const SELECTION_FILE = 'active-account.json'

/** Stable opaque directory name; account-controlled identifiers never become path components. */
export function accountProfileId(wxid: string | undefined): string {
  return wxid ? createHash('sha256').update(wxid).digest('hex') : 'unbound'
}

/** Complete account environment, selected only by a successful explicit connection. */
export interface AccountProfile {
  paths: AppPaths
  wxid: string | undefined
  select(config: AppConfig): AppPaths
}

function profilePaths(base: AppPaths, wxid: string | undefined): AppPaths {
  const dataRoot = join(base.dataRoot, 'accounts', accountProfileId(wxid))
  const paths = { ...base }
  // Resource paths stay shared; every mutable path, including workspace and secrets, moves together.
  for (const key of Object.keys(base) as Array<keyof AppPaths>) {
    const value = base[key]
    if (typeof value !== 'string') continue
    const suffix = relative(base.dataRoot, value)
    if (suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix))) {
      Object.assign(paths, { [key]: join(dataRoot, suffix) })
    }
  }
  paths.applicationDataRoot = base.dataRoot
  paths.accountScope = accountProfileId(wxid)
  return paths
}

function seedConfig(paths: AppPaths, source: AppConfig): void {
  if (existsSync(paths.configFile)) return
  // Legacy stores may contain several owners. Keep them untouched and never infer their ownership.
  createConfigService({
    file: paths.configFile,
    initial: () => ({ general: source.general, ai: source.ai, account: source.account, onboarding: source.onboarding }),
  })
}

/** Prepare an isolated destination without selecting it or touching an existing owner's settings. */
export function prepareAccountProfile(base: AppPaths, config: AppConfig): AppPaths {
  const paths = profilePaths(base, config.account.wxid)
  ensureDirs(paths)
  seedConfig(paths, config)
  return paths
}

/** Open only the selected profile; old flat stores remain quarantined outside its allow-list. */
export function openAccountProfile(base: AppPaths, language?: AppConfig['general']['language']): AccountProfile {
  const legacy = createConfigService({ file: base.configFile, initial: () => ({ general: { language } }) }).get()
  const selectionFile = join(base.dataRoot, SELECTION_FILE)
  let account = legacy.account
  if (existsSync(selectionFile)) {
    // Invalid selection is a startup failure: falling back could expose a different owner's profile.
    account = AppConfigSchema.shape.account.parse(JSON.parse(readFileSync(selectionFile, 'utf8')))
  }
  const paths = profilePaths(base, account.wxid)
  ensureDirs(paths)
  seedConfig(paths, { ...legacy, account })
  const saved = createConfigService({ file: paths.configFile }).get().account
  if (accountProfileId(saved.wxid) !== paths.accountScope) throw new Error(t('main.substrate.accountMismatch'))
  return {
    paths,
    wxid: account.wxid,
    select(config) {
      const next = AppConfigSchema.parse(config)
      const target = profilePaths(base, next.account.wxid)
      ensureDirs(target)
      seedConfig(target, next)
      createConfigService({ file: target.configFile }).set({ account: next.account })
      atomicWriteJson(selectionFile, next.account)
      return target
    },
  }
}

/** Other profiles and legacy stores are never accessible through a broadened directory picker grant. */
export function foreignAccountPaths(paths: AppPaths): string[] {
  const root = paths.applicationDataRoot
  if (!root) return []
  const profiles = join(root, 'accounts')
  const blocked = readdirSync(root).flatMap((name) => {
    if (name !== 'accounts') return [join(root, name)]
    return readdirSync(profiles)
      .filter((id) => id !== paths.accountScope)
      .map((id) => join(profiles, id))
  })
  const configs = [
    { file: join(root, 'config.json'), id: undefined },
    ...readdirSync(profiles)
      .filter((id) => id !== paths.accountScope)
      .map((id) => ({ file: join(profiles, id, 'config.json'), id })),
  ]
  for (const { file, id } of configs) {
    if (!existsSync(file)) continue
    // These are app-owned configs. Invalid files fail closed instead of dropping a privacy boundary.
    const config = AppConfigSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    const custom = customCacheDir(config.account.cacheDir)
    if (!custom || !validateCacheDir(custom).ok) continue
    blocked.push(...(id ? [join(custom, 'aiwc-accounts', id)] : [join(custom, 'wcdb-plain'), join(custom, 'media')]))
  }
  return blocked
}
