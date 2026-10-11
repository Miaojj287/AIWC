/**
 * All on-disk locations the main process uses. Pure: takes the values normally read from
 * `electron.app` as inputs, so it can be unit-tested and reused from the utility-process host.
 *
 * Layout (docs/ARCHITECTURE.md §8):
 *   <userData>/aiwc/{config.json, secrets.bin, rollouts/, index.db, mirror.db, records.db,
 *                    memory/, relationships/, todo/, skills/{user,agent}, pets/, cache/media, logs/}
 */
import { mkdirSync } from 'node:fs'
import { decryptedCopyDir } from '@aiwc/substrate'
import { dirname, join } from 'node:path'

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
  /** Shared installation root; never a renderer allow-list root. */
  applicationDataRoot?: string
  /** Immutable identity for this process and its Chromium storage partition. */
  accountScope?: string
  dataRoot: string
  configFile: string
  secretsFile: string
  windowStateFile: string
  rolloutsDir: string
  indexDb: string
  mirrorDb: string
  recordsDb: string
  /** 设置 › 用量与记录: model call log and usage roll-ups (may hold redacted request / response content). */
  usageDb: string
  memoryDir: string
  relationshipsDir: string
  /** 每日待办: the checklist, per-day chat summaries and scan cursors. */
  todoDir: string
  /**
   * diaries/ of the retired 日记 pipeline (removed 2026-09-27). Never created or written again, but an
   * existing one still holds chat-derived text, so it stays out of the shell tool's reach.
   */
  legacyDiariesDir: string
  skillsUserDir: string
  skillsAgentDir: string
  skillsBuiltinDir: string
  /** AI 宠物: installed / imported pets, one folder per id (pet.json + spritesheet). */
  petsDir: string
  /** resources/pets — pets bundled with the app, seeded into petsDir. */
  petsBuiltinDir: string
  cacheDir: string
  mediaCacheDir: string
  logsDir: string
  mainLogFile: string
  gatewayStateDir: string
  exportsDir: string
  /** Where the agent's `shell` tool runs and may write; the only always-writable place in its sandbox. */
  workspaceDir: string
  /** 定时任务 definitions and run history. */
  tasksDir: string
  /** 我的微信: state.json (bot binding, push targets) + sends.jsonl. */
  mobileDir: string
  /** Unsent Agent composer drafts (electron/main/ipc/composer.ts). */
  composerDraftsFile: string
  /** The Agent change journal (what each turn changed + the bytes it replaced, for 撤销). */
  changesDir: string
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
    usageDb: join(dataRoot, 'usage.db'),
    memoryDir: join(dataRoot, 'memory'),
    relationshipsDir: join(dataRoot, 'relationships'),
    todoDir: join(dataRoot, 'todo'),
    legacyDiariesDir: join(dataRoot, 'diaries'),
    skillsUserDir: join(skillsDir, 'user'),
    skillsAgentDir: join(skillsDir, 'agent'),
    skillsBuiltinDir: join(resourceBase, 'skills'),
    petsDir: join(dataRoot, 'pets'),
    petsBuiltinDir: join(resourceBase, 'resources', 'pets'),
    cacheDir,
    mediaCacheDir: join(cacheDir, 'media'),
    logsDir,
    mainLogFile: join(logsDir, 'main.log'),
    gatewayStateDir: join(dataRoot, 'gateway'),
    exportsDir: join(dataRoot, 'exports'),
    workspaceDir: join(dataRoot, 'workspace'),
    tasksDir: join(dataRoot, 'tasks'),
    mobileDir: join(dataRoot, 'mobile'),
    composerDraftsFile: join(dataRoot, 'composer-drafts.json'),
    changesDir: join(dataRoot, 'changes'),
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
    paths.todoDir,
    paths.skillsUserDir,
    paths.skillsAgentDir,
    paths.petsDir,
    paths.cacheDir,
    paths.mediaCacheDir,
    paths.logsDir,
    paths.gatewayStateDir,
    paths.exportsDir,
    paths.workspaceDir,
    paths.tasksDir,
  ]
  for (const d of dirs) mkdirSync(d, { recursive: true })
}

/**
 * The cache dir the substrate engine is handed (media, decrypted images, plaintext database copies): the
 * account's validated custom cache dir when set, else `<cache>/media`. The one resolver both the engine
 * wiring and `protectedDataPaths` use, so the protected list always names where the copies really are.
 */
export function substrateCacheDir(paths: AppPaths, override: string | undefined): string {
  return override
    ? paths.accountScope
      ? join(override, 'aiwc-accounts', paths.accountScope)
      : override
    : paths.mediaCacheDir
}

/**
 * What the Agent's `shell` tool must never read: everything the user's own data lives in, plus the key
 * store and the channel state (it holds a bearer token). They become read denials in the sandbox, and
 * any command naming one of them is classified destructive. The workspace is deliberately absent — that
 * is where the tool does its work. The renderer's `file:write` refuses the same list (those stores have
 * their own validated IPC). `cacheDirOverride` is the account's current custom cache dir: call this per
 * command, since that setting can change while the app runs.
 */
export function protectedDataPaths(paths: AppPaths, cacheDirOverride?: string): string[] {
  const plaintextCopies = [
    // Plaintext copies of WeChat's own databases, written by the SQLCipher engine under its cache dir.
    decryptedCopyDir(substrateCacheDir(paths, cacheDirOverride)),
    // The default location, still protected after switching to a custom dir (old copies may remain there).
    decryptedCopyDir(paths.mediaCacheDir),
    // Builds before 2026-10 wrote them directly under <cache>.
    decryptedCopyDir(paths.cacheDir),
  ]
  return [
    ...new Set(plaintextCopies),
    paths.secretsFile,
    paths.configFile,
    // SQLite keeps recent pages in -wal / -shm next to the database: they leak as much as the file.
    ...sqliteFiles(paths.mirrorDb),
    ...sqliteFiles(paths.indexDb),
    ...sqliteFiles(paths.recordsDb),
    // The model call log (may hold redacted request / response content) and usage roll-ups.
    ...sqliteFiles(paths.usageDb),
    paths.rolloutsDir,
    paths.memoryDir,
    paths.relationshipsDir,
    paths.todoDir,
    paths.legacyDiariesDir,
    paths.gatewayStateDir,
    // Replaced file bytes and memory entries kept for 撤销.
    paths.changesDir,
    // MCP servers and hooks name commands the app runs: the agent must not rewrite them behind the user.
    extensionsFile(paths),
    // 定时任务: each task's prompt, grants and permission mode — rewriting one escalates the next run.
    paths.tasksDir,
    // 我的微信: the bot binding and where task results are pushed.
    paths.mobileDir,
    // Unsent drafts and generated exports (chat history, Agent threads): user content.
    paths.composerDraftsFile,
    paths.exportsDir,
    // Logs carry scoped metadata about chats and accounts even after redaction.
    paths.logsDir,
    // 清除全部数据 marker, next to the data root: names folders the next start deletes.
    resetMarkerFile(paths),
  ]
}

const sqliteFiles = (db: string): string[] => [db, `${db}-wal`, `${db}-shm`]

/** File next to the data root (inside userData) that requests a wipe on the next start (services/dataReset.ts). */
export const RESET_MARKER_NAME = 'aiwc-reset.json'

/** Where the 清除全部数据 marker lives: beside the data root, so the wipe cannot delete it mid-way. */
export function resetMarkerFile(paths: Pick<AppPaths, 'dataRoot'>): string {
  return join(dirname(paths.dataRoot), RESET_MARKER_NAME)
}

/** 设置 › 扩展: MCP servers and user hooks (electron/main/extensions/store.ts). */
export function extensionsFile(paths: Pick<AppPaths, 'dataRoot'>): string {
  return join(paths.dataRoot, 'extensions.json')
}

/** Roots the renderer may read/write through `file:*` and `aiwc-media://` by default. */
export function defaultAllowedRoots(paths: AppPaths, extra: { cacheDir?: string } = {}): string[] {
  const roots = [paths.dataRoot, paths.cacheDir]
  if (extra.cacheDir && !roots.includes(extra.cacheDir)) roots.push(extra.cacheDir)
  return roots
}
