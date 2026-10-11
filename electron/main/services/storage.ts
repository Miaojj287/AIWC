/**
 * 设置 › 数据: what the data root (and a custom WeChat cache folder) holds, per category, and clearing
 * the caches that are rebuilt on demand. Locations are derived from AppPaths only — never from the
 * renderer — and a clear refuses any target that is neither inside the data root nor one of the
 * AIWC-owned folders (`media`, `wcdb-plain`) of the validated custom cache folder.
 */
import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { decryptedCopyDir } from '@aiwc/substrate'
import {
  STORAGE_CATEGORIES,
  type ClearableStorageCategory,
  type StorageCategory,
  type StorageCategoryUsage,
  type StorageUsage,
} from '@aiwc/protocol'
import { substrateCacheDir, type AppPaths } from '../paths'
import { isWithinRoot } from '../security/pathAllowList'
import { PREVIEW_STAGE_DIR_NAME } from './chatFileStage'

/** Files visited before a measurement gives up and reports a partial size. */
const MAX_WALK_ENTRIES = 400_000
/** lstat calls in flight at once while walking. */
const WALK_CONCURRENCY = 32
/** Folder the substrate writes decrypted media into, under its cache dir (see substrate mediaResolver). */
const SUBSTRATE_MEDIA_DIR_NAME = 'media'
/** Names a clear may delete outside the data root: the AIWC-owned folders of a custom cache folder. */
const OWNED_EXTERNAL_NAMES = new Set([SUBSTRATE_MEDIA_DIR_NAME, 'wcdb-plain'])

type MeasuredCategory = Exclude<StorageCategory, 'other'>

const sqliteFiles = (db: string): string[] => [db, `${db}-wal`, `${db}-shm`]

/** `<cache>/previews`: chat attachments staged for in-app preview. */
export const previewStageDir = (paths: AppPaths): string => join(paths.cacheDir, PREVIEW_STAGE_DIR_NAME)

/** Where each category lives. `cacheOverride` is the validated custom WeChat cache folder, if any. */
export function storageLocations(paths: AppPaths, cacheOverride?: string): Record<MeasuredCategory, string[]> {
  const substrateCache = substrateCacheDir(paths, cacheOverride)
  const uniq = (list: string[]) => [...new Set(list)]
  return {
    index: sqliteFiles(paths.mirrorDb),
    plaintext: uniq([
      decryptedCopyDir(substrateCache),
      decryptedCopyDir(paths.mediaCacheDir),
      decryptedCopyDir(paths.cacheDir),
    ]),
    media: uniq([
      join(substrateCache, SUBSTRATE_MEDIA_DIR_NAME),
      join(paths.mediaCacheDir, SUBSTRATE_MEDIA_DIR_NAME),
      previewStageDir(paths),
    ]),
    conversations: [paths.rolloutsDir, ...sqliteFiles(paths.indexDb)],
    memory: [paths.memoryDir, paths.relationshipsDir],
    features: [
      ...sqliteFiles(paths.recordsDb),
      ...sqliteFiles(paths.usageDb),
      paths.todoDir,
      paths.tasksDir,
      paths.gatewayStateDir,
      paths.legacyDiariesDir,
    ],
    skills: [dirname(paths.skillsUserDir)],
    pets: [paths.petsDir],
    workspace: [paths.workspaceDir],
    exports: [paths.exportsDir],
    logs: [paths.logsDir],
  }
}

interface WalkTotals {
  bytes: number
  files: number
  partial: boolean
}

/**
 * Walk `root` (a file or a folder) without following symlinks, calling `onFile` per regular file.
 * A missing root is simply empty; unreadable entries are skipped.
 */
async function walk(
  root: string,
  onFile: (path: string, size: number) => void,
  budget: { left: number },
): Promise<boolean> {
  const first = await lstat(root).catch(() => undefined) // missing → nothing to count
  if (!first) return true
  if (first.isFile()) {
    onFile(root, first.size)
    return true
  }
  if (!first.isDirectory()) return true
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    if (dir === undefined) break
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []) // unreadable folder: skip it
    for (let i = 0; i < entries.length; i += WALK_CONCURRENCY) {
      const batch = entries.slice(i, i + WALK_CONCURRENCY)
      if (budget.left <= 0) return false
      budget.left -= batch.length
      const stats = await Promise.all(
        batch.map(async (entry) => {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) return { path, dir: true, size: 0 }
          if (!entry.isFile()) return undefined // symlinks, sockets: not counted
          const st = await lstat(path).catch(() => undefined) // vanished meanwhile
          return st ? { path, dir: false, size: st.size } : undefined
        }),
      )
      for (const s of stats) {
        if (!s) continue
        if (s.dir) stack.push(s.path)
        else onFile(s.path, s.size)
      }
    }
  }
  return true
}

/** Sizes per category; `other` = what the data root holds beyond the listed locations. */
export async function measureStorage(paths: AppPaths, cacheOverride?: string, now = Date.now()): Promise<StorageUsage> {
  const locations = storageLocations(paths, cacheOverride)
  const totals = new Map<StorageCategory, WalkTotals>(
    STORAGE_CATEGORIES.map((c) => [c, { bytes: 0, files: 0, partial: false }]),
  )
  // Longest location first, so a nested one (cache/media/wcdb-plain) wins over its parent.
  const inside = Object.entries(locations)
    .flatMap(([category, list]) => list.map((path) => ({ category: category as MeasuredCategory, path })))
    .sort((a, b) => b.path.length - a.path.length)
  const categoryOf = (file: string): StorageCategory =>
    inside.find((loc) => isWithinRoot(file, loc.path))?.category ?? 'other'
  const add = (category: StorageCategory, size: number) => {
    const t = totals.get(category)
    if (!t) return
    t.bytes += size
    t.files += 1
  }

  const budget = { left: MAX_WALK_ENTRIES }
  const complete = await walk(paths.dataRoot, (file, size) => add(categoryOf(file), size), budget)
  if (!complete) for (const t of totals.values()) t.partial = true
  // Locations outside the data root (a custom WeChat cache folder) are walked on their own.
  for (const loc of inside) {
    if (isWithinRoot(loc.path, paths.dataRoot)) continue
    if (inside.some((o) => o !== loc && o.path.length < loc.path.length && isWithinRoot(loc.path, o.path))) continue
    const done = await walk(loc.path, (file, size) => add(loc.category, size), budget)
    const t = totals.get(loc.category)
    if (!done && t) t.partial = true
  }

  const categories: StorageCategoryUsage[] = STORAGE_CATEGORIES.map((id) => {
    const t = totals.get(id) ?? { bytes: 0, files: 0, partial: false }
    const path = id === 'other' ? paths.dataRoot : locations[id][0]
    return { id, bytes: t.bytes, files: t.files, ...(t.partial ? { partial: true } : {}), ...(path ? { path } : {}) }
  })
  return {
    dataRoot: paths.dataRoot,
    totalBytes: categories.reduce((sum, c) => sum + c.bytes, 0),
    categories,
    measuredAt: now,
  }
}

/** A delete target is inside the data root, or an AIWC-owned folder of the custom cache folder. */
export function isClearableTarget(target: string, paths: AppPaths, cacheOverride?: string): boolean {
  if (isWithinRoot(target, paths.dataRoot) && target !== paths.dataRoot) return true
  if (!cacheOverride) return false
  return OWNED_EXTERNAL_NAMES.has(basename(target)) && dirname(target) === cacheOverride
}

export interface ClearStorageDeps {
  paths: AppPaths
  cacheOverride(): string | undefined
  /** Plaintext copies are open while WeChat data is read: close the substrate first, reopen after. */
  substrate: { shutdown(): Promise<void>; start(): Promise<void> }
}

async function sizeOf(targets: string[]): Promise<number> {
  let bytes = 0
  const budget = { left: MAX_WALK_ENTRIES }
  for (const target of targets) await walk(target, (_file, size) => (bytes += size), budget)
  return bytes
}

/** Delete one rebuildable cache. Returns the bytes freed. */
export async function clearStorage(category: ClearableStorageCategory, deps: ClearStorageDeps): Promise<number> {
  const override = deps.cacheOverride()
  const locations = storageLocations(deps.paths, override)
  switch (category) {
    case 'plaintext': {
      const targets = locations.plaintext.filter((p) => isClearableTarget(p, deps.paths, override))
      const freed = await sizeOf(targets)
      await deps.substrate.shutdown()
      try {
        for (const target of targets) await rm(target, { recursive: true, force: true })
      } finally {
        await deps.substrate.start()
      }
      return freed
    }
    case 'media': {
      const targets = locations.media.filter((p) => isClearableTarget(p, deps.paths, override))
      const freed = await sizeOf(targets)
      for (const target of targets) await rm(target, { recursive: true, force: true })
      return freed
    }
    case 'logs': {
      // main.log is the file being written right now; its rotated predecessors go.
      const keep = deps.paths.mainLogFile
      let freed = 0
      const entries = await readdir(deps.paths.logsDir, { withFileTypes: true }).catch(() => []) // no logs folder yet
      for (const entry of entries) {
        const path = join(deps.paths.logsDir, entry.name)
        if (!entry.isFile() || path === keep) continue
        const st = await lstat(path).catch(() => undefined) // vanished meanwhile
        try {
          await rm(path, { force: true })
          freed += st?.size ?? 0
        } catch {
          // A log another process still holds open (Windows) is left for the next clear.
        }
      }
      return freed
    }
  }
}
