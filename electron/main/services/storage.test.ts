import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaths, ensureDirs, type AppPaths } from '../paths'
import { applyPendingDataReset, externalResetDirs, resetMarkerPath, scheduleDataReset } from './dataReset'
import { clearStorage, isClearableTarget, measureStorage, previewStageDir } from './storage'

vi.mock('../i18n', () => ({ t: (key: string) => key }))

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

function setup(): { paths: AppPaths; external: string } {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-storage-'))
  dirs.push(root)
  const paths = createPaths({
    userData: join(root, 'userData'),
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    platform: 'darwin',
    arch: 'arm64',
  })
  ensureDirs(paths)
  const external = join(root, 'customCache')
  mkdirSync(external, { recursive: true })
  return { paths, external }
}

function put(path: string, bytes: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 1))
}

const sizeOf = (usage: Awaited<ReturnType<typeof measureStorage>>, id: string) =>
  usage.categories.find((c) => c.id === id)?.bytes

describe('measureStorage', () => {
  it('sorts every file of the data root into one category and counts a custom cache folder too', async () => {
    const { paths, external } = setup()
    put(paths.mirrorDb, 100)
    put(`${paths.mirrorDb}-wal`, 10)
    put(join(paths.mediaCacheDir, 'wcdb-plain', 'message_0.db'), 1000)
    put(join(paths.mediaCacheDir, 'media', 's1', 'img.jpg'), 200)
    put(join(previewStageDir(paths), 'abc', 'report.pdf'), 50)
    put(join(paths.rolloutsDir, 't1.jsonl'), 30)
    put(paths.configFile, 7)
    put(join(paths.logsDir, 'main.log'), 5)
    put(join(external, 'wcdb-plain', 'contact.db'), 400)
    put(join(external, 'media', 'x.jpg'), 4)

    const usage = await measureStorage(paths, external, 42)
    expect(sizeOf(usage, 'index')).toBe(110)
    expect(sizeOf(usage, 'plaintext')).toBe(1400)
    expect(sizeOf(usage, 'media')).toBe(254)
    expect(sizeOf(usage, 'conversations')).toBe(30)
    expect(sizeOf(usage, 'logs')).toBe(5)
    expect(sizeOf(usage, 'other')).toBe(7)
    expect(usage.totalBytes).toBe(110 + 1400 + 254 + 30 + 5 + 7)
    expect(usage.measuredAt).toBe(42)
  })
})

describe('clearStorage', () => {
  it('closes the substrate around deleting plaintext copies and reports what was freed', async () => {
    const { paths, external } = setup()
    put(join(paths.mediaCacheDir, 'wcdb-plain', 'a.db'), 300)
    put(join(external, 'wcdb-plain', 'b.db'), 20)
    put(join(external, 'keep.txt'), 1)
    const order: string[] = []
    const substrate = {
      shutdown: vi.fn(async () => {
        order.push('shutdown')
      }),
      start: vi.fn(async () => {
        order.push(existsSync(join(paths.mediaCacheDir, 'wcdb-plain')) ? 'start-before-delete' : 'start')
      }),
    }
    const freed = await clearStorage('plaintext', { paths, cacheOverride: () => external, substrate })
    expect(freed).toBe(320)
    expect(order).toEqual(['shutdown', 'start'])
    expect(existsSync(join(external, 'wcdb-plain'))).toBe(false)
    expect(existsSync(join(external, 'keep.txt'))).toBe(true)
  })

  it('reopens the substrate even when deleting fails', async () => {
    const { paths } = setup()
    const substrate = { shutdown: vi.fn(async () => undefined), start: vi.fn(async () => undefined) }
    await clearStorage('plaintext', { paths, cacheOverride: () => undefined, substrate })
    expect(substrate.start).toHaveBeenCalledTimes(1)
  })

  it('clears media and staged previews, and every log but the one being written', async () => {
    const { paths } = setup()
    put(join(paths.mediaCacheDir, 'media', 's', 'a.jpg'), 10)
    put(join(previewStageDir(paths), 'k', 'a.pdf'), 5)
    put(paths.mainLogFile, 3)
    put(join(paths.logsDir, 'main.1.log'), 8)
    const substrate = { shutdown: vi.fn(), start: vi.fn() }
    expect(await clearStorage('media', { paths, cacheOverride: () => undefined, substrate })).toBe(15)
    expect(existsSync(previewStageDir(paths))).toBe(false)
    expect(await clearStorage('logs', { paths, cacheOverride: () => undefined, substrate })).toBe(8)
    expect(existsSync(paths.mainLogFile)).toBe(true)
    expect(substrate.shutdown).not.toHaveBeenCalled()
  })

  it('only deletes inside the data root or the owned folders of the custom cache', () => {
    const { paths, external } = setup()
    expect(isClearableTarget(paths.dataRoot, paths)).toBe(false)
    expect(isClearableTarget(join(paths.cacheDir, 'x'), paths)).toBe(true)
    expect(isClearableTarget(join(external, 'media'), paths, external)).toBe(true)
    expect(isClearableTarget(join(external, 'photos'), paths, external)).toBe(false)
    expect(isClearableTarget(join(external, 'media'), paths)).toBe(false)
  })
})

describe('data reset', () => {
  const writeConfig = (paths: AppPaths, cacheDir: string): void => {
    mkdirSync(dirname(paths.configFile), { recursive: true })
    writeFileSync(paths.configFile, JSON.stringify({ version: 1, account: { cacheDir } }))
  }

  it("deletes the data root and the configured cache folder's owned folders on the next start, then the marker", () => {
    const { paths, external } = setup()
    writeConfig(paths, external)
    put(join(external, 'wcdb-plain', 'c.db'), 3)
    put(join(external, 'media', 'img.jpg'), 3)
    put(join(external, 'photos', 'mine.jpg'), 3)
    scheduleDataReset(paths.dataRoot)

    const outcome = applyPendingDataReset(paths)
    expect(outcome.applied).toBe(true)
    expect(existsSync(paths.dataRoot)).toBe(false)
    expect(existsSync(join(external, 'wcdb-plain'))).toBe(false)
    expect(existsSync(join(external, 'media'))).toBe(false)
    expect(existsSync(join(external, 'photos', 'mine.jpg'))).toBe(true)
    expect(existsSync(resetMarkerPath(paths.dataRoot))).toBe(false)
    expect(applyPendingDataReset(paths)).toEqual({ applied: false })
  })

  it('ignores folders a planted marker names: only the saved config decides what lies outside the data root', () => {
    const { paths, external } = setup()
    const victim = join(dirname(external), 'Projects', 'media')
    put(join(victim, 'keep.txt'), 3)
    put(join(external, 'wcdb-plain', 'c.db'), 3)
    writeFileSync(
      resetMarkerPath(paths.dataRoot),
      JSON.stringify({ version: 1, requestedAt: 1, externalDirs: [victim, join(external, 'wcdb-plain')] }),
    )
    const outcome = applyPendingDataReset(paths)
    expect(outcome).toMatchObject({ applied: true, removed: [paths.dataRoot] })
    expect(existsSync(join(victim, 'keep.txt'))).toBe(true)
    // No custom cache dir in the config: the external copies are not known to be ours.
    expect(existsSync(join(external, 'wcdb-plain', 'c.db'))).toBe(true)
  })

  it('refuses a configured cache dir that is relative, a filesystem root or the home directory', () => {
    const { paths, external } = setup()
    for (const bad of ['relative/cache', '/', external]) {
      writeConfig(paths, bad)
      expect(externalResetDirs(paths, bad === external ? external : undefined)).toEqual([])
    }
  })

  it('never wipes on a malformed marker', () => {
    const { paths } = setup()
    put(paths.configFile, 3)
    writeFileSync(resetMarkerPath(paths.dataRoot), '{"version":2}')
    expect(applyPendingDataReset(paths)).toEqual({ applied: false })
    expect(existsSync(paths.configFile)).toBe(true)
    expect(existsSync(resetMarkerPath(paths.dataRoot))).toBe(false)
  })
})
