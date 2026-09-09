/**
 * All on-disk locations the main process uses. Pure: takes the values normally read from
 * `electron.app` as inputs, so it can be unit-tested and reused from the utility-process host.
 *
 * Layout (docs/ARCHITECTURE.md §8):
 *   <userData>/aiwc/{config.json, secrets.bin, rollouts/, index.db, mirror.db, records.db,
 *                    memory/, relationships/, diaries/, skills/{user,agent}, cache/media, logs/}
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface PathInputs {
  /** app.getPath('userData') */
  userData: string
  /** app.isPackaged */
  isPackaged: boolean
  /** process.resourcesPath (only meaningful when packaged) */
  resourcesPath: string
  /** app.getAppPath(): the repo root in dev, the asar root when packaged */
  appPath: string
  platform: NodeJS.Platform
  arch: string
}

export interface AppPaths {
  dataRoot: string
  configFile: string
  secretsFile: string
  windowStateFile: string
  rolloutsDir: string
  indexDb: string
  mirrorDb: string
  recordsDb: string
  memoryDir: string
  relationshipsDir: string
  diariesDir: string
  skillsUserDir: string
  skillsAgentDir: string
  skillsBuiltinDir: string
  cacheDir: string
  mediaCacheDir: string
  logsDir: string
  mainLogFile: string
  gatewayStateDir: string
  exportsDir: string
  /** resources/native/<platform>-<arch> */
  nativeDir: string
  platformArch: string
}

export const platformArchKey = (platform: NodeJS.Platform, arch: string): string => `${platform}-${arch}`

export function createPaths(input: PathInputs): AppPaths {
  const dataRoot = join(input.userData, 'aiwc')
  const platformArch = platformArchKey(input.platform, input.arch)
  // electron-builder copies `resources/` → <resourcesPath>/resources and `skills/` → <resourcesPath>/skills
  const resourceBase = input.isPackaged ? input.resourcesPath : input.appPath
  const cacheDir = join(dataRoot, 'cache')
  const skillsDir = join(dataRoot, 'skills')
  const logsDir = join(dataRoot, 'logs')
  return {
    dataRoot,
    configFile: join(dataRoot, 'config.json'),
    secretsFile: join(dataRoot, 'secrets.bin'),
    windowStateFile: join(dataRoot, 'window-state.json'),
    rolloutsDir: join(dataRoot, 'rollouts'),
    indexDb: join(dataRoot, 'index.db'),
    mirrorDb: join(dataRoot, 'mirror.db'),
    recordsDb: join(dataRoot, 'records.db'),
    memoryDir: join(dataRoot, 'memory'),
    relationshipsDir: join(dataRoot, 'relationships'),
    diariesDir: join(dataRoot, 'diaries'),
    skillsUserDir: join(skillsDir, 'user'),
    skillsAgentDir: join(skillsDir, 'agent'),
    skillsBuiltinDir: join(resourceBase, 'skills'),
    cacheDir,
    mediaCacheDir: join(cacheDir, 'media'),
    logsDir,
    mainLogFile: join(logsDir, 'main.log'),
    gatewayStateDir: join(dataRoot, 'gateway'),
    exportsDir: join(dataRoot, 'exports'),
    nativeDir: join(resourceBase, 'resources', 'native', platformArch),
    platformArch,
  }
}

/** Directories that must exist before any store opens. Idempotent. */
export function ensureDirs(paths: AppPaths): void {
  const dirs = [
    paths.dataRoot,
    paths.rolloutsDir,
    paths.memoryDir,
    paths.relationshipsDir,
    paths.diariesDir,
    paths.skillsUserDir,
    paths.skillsAgentDir,
    paths.cacheDir,
    paths.mediaCacheDir,
    paths.logsDir,
    paths.gatewayStateDir,
    paths.exportsDir,
  ]
  for (const d of dirs) mkdirSync(d, { recursive: true })
}

/** Roots the renderer may read/write through `file:*` and `aiwc-media://` by default. */
export function defaultAllowedRoots(paths: AppPaths, extra: { cacheDir?: string } = {}): string[] {
  const roots = [paths.dataRoot, paths.cacheDir]
  if (extra.cacheDir && !roots.includes(extra.cacheDir)) roots.push(extra.cacheDir)
  return roots
}
