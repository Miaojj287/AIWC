/**
 * 清除全部数据. Deleting the data root while its databases, logs and key store are open is unsafe, so
 * the request only writes a marker next to the data root and relaunches; the next start applies the
 * marker before anything opens (index.ts → bootstrap), and the app comes up on onboarding.
 *
 * Besides the data root, a wipe deletes the AIWC-owned folders (`wcdb-plain`, `media`) of the custom
 * WeChat cache folder — plaintext copies must not outlive it. Those folders are derived at apply time
 * from the saved config (validated like at startup), never read from the marker: the marker sits on disk
 * between two runs, and a planted one must not be able to name folders elsewhere on the disk.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { decryptedCopyDir } from '@aiwc/substrate'
import { resetMarkerFile, type AppPaths } from '../paths'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
import { isForbiddenRoot, isWithinRoot } from '../security/pathAllowList'

/** Folder the substrate writes decrypted media into, under its cache dir. */
const SUBSTRATE_MEDIA_DIR_NAME = 'media'

const markerSchema = z.object({
  version: z.literal(1),
  requestedAt: z.number(),
  // Builds before 2026-10 listed folders here; the list is ignored now (derived from the config instead).
  externalDirs: z.array(z.string().max(4096)).max(8).optional(),
})

export const resetMarkerPath = (dataRoot: string): string => resetMarkerFile({ dataRoot })

/** Request a wipe on the next start. */
export function scheduleDataReset(dataRoot: string, now = Date.now()): void {
  const marker: z.infer<typeof markerSchema> = { version: 1, requestedAt: now }
  writeFileSync(resetMarkerPath(dataRoot), JSON.stringify(marker), 'utf8')
}

/**
 * The AIWC-owned folders of the custom cache dir named by the saved config, when it is valid
 * (absolute, not a filesystem root or home) and outside the data root (inside, the wipe takes it anyway).
 */
export function externalResetDirs(paths: Pick<AppPaths, 'dataRoot' | 'configFile'>, home?: string): string[] {
  let raw: unknown
  try {
    const config: unknown = JSON.parse(readFileSync(paths.configFile, 'utf8'))
    raw = (config as { account?: { cacheDir?: unknown } } | null)?.account?.cacheDir
  } catch {
    return [] // no or unreadable config: nothing outside the data root is known to be ours
  }
  const custom = customCacheDir(raw)
  if (!custom) return []
  const verdict = validateCacheDir(custom, home === undefined ? {} : { home })
  if (!verdict.ok || isWithinRoot(verdict.dir, paths.dataRoot)) return []
  return [decryptedCopyDir(verdict.dir), join(verdict.dir, SUBSTRATE_MEDIA_DIR_NAME)].filter((dir) =>
    isDeletableExternal(dir, home),
  )
}

const EXTERNAL_NAMES = new Set([basename(decryptedCopyDir('/')), SUBSTRATE_MEDIA_DIR_NAME])

function isDeletableExternal(dir: string, home?: string): boolean {
  return (
    isAbsolute(dir) &&
    !dir.includes('\0') &&
    EXTERNAL_NAMES.has(basename(dir)) &&
    !isForbiddenRoot(dir, home) &&
    !isForbiddenRoot(dirname(dir), home)
  )
}

export type ResetOutcome = { applied: false } | { applied: true; removed: string[]; failed: string[] }

/**
 * Apply a pending wipe, if any: delete the data root and the custom cache dir's owned folders, then the
 * marker. A malformed marker is deleted without wiping anything. Runs before the logger exists, so the
 * outcome is returned for the caller to log. `home` is injectable for tests.
 */
export function applyPendingDataReset(
  paths: Pick<AppPaths, 'dataRoot' | 'configFile'>,
  opts: { home?: string } = {},
): ResetOutcome {
  const markerFile = resetMarkerPath(paths.dataRoot)
  if (!existsSync(markerFile)) return { applied: false }
  let parsed: z.infer<typeof markerSchema> | undefined
  try {
    parsed = markerSchema.parse(JSON.parse(readFileSync(markerFile, 'utf8')))
  } catch {
    parsed = undefined // unreadable marker: never wipe on a guess
  }
  const removed: string[] = []
  const failed: string[] = []
  if (parsed && !isForbiddenRoot(paths.dataRoot, opts.home)) {
    // Read the config before the data root (which holds it) is gone.
    const profiles = join(paths.dataRoot, 'accounts')
    const accountCaches = existsSync(profiles)
      ? readdirSync(profiles)
          .filter((id) => /^[a-f0-9]{64}$/.test(id))
          .flatMap((id) => {
            const profile = { dataRoot: join(profiles, id), configFile: join(profiles, id, 'config.json') }
            return externalResetDirs(profile, opts.home).map((dir) =>
              join(dirname(dir), 'aiwc-accounts', id, basename(dir)),
            )
          })
      : []
    const external = [...new Set([...externalResetDirs(paths, opts.home), ...accountCaches])]
    for (const dir of [paths.dataRoot, ...external]) {
      try {
        rmSync(dir, { recursive: true, force: true })
        removed.push(dir)
      } catch {
        failed.push(dir)
      }
    }
  }
  rmSync(markerFile, { force: true })
  return parsed ? { applied: true, removed, failed } : { applied: false }
}
