import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptedCopyDir } from '@aiwc/substrate'
import {
  createPaths,
  defaultAllowedRoots,
  ensureDirs,
  extensionsFile,
  platformArchKey,
  protectedDataPaths,
  resetMarkerFile,
  substrateCacheDir,
} from './paths'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-paths-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('paths', () => {
  it('lays out the data root under <userData>/aiwc and resolves dev resources from appPath', () => {
    const p = createPaths({
      userData: dir,
      isPackaged: false,
      resourcesPath: '/unused',
      appPath: '/repo',
      platform: 'darwin',
      arch: 'arm64',
    })
    expect(p.dataRoot).toBe(join(dir, 'aiwc'))
    expect(p.configFile).toBe(join(dir, 'aiwc', 'config.json'))
    expect(p.secretsFile).toBe(join(dir, 'aiwc', 'secrets.bin'))
    expect(p.mediaCacheDir).toBe(join(dir, 'aiwc', 'cache', 'media'))
    expect(p.mainLogFile).toBe(join(dir, 'aiwc', 'logs', 'main.log'))
    expect(p.skillsUserDir).toBe(join(dir, 'aiwc', 'skills', 'user'))
    expect(p.nativeDir).toBe(join('/repo', 'resources', 'native', 'darwin-arm64'))
    expect(p.skillsBuiltinDir).toBe(join('/repo', 'skills'))
    expect(p.petsDir).toBe(join(dir, 'aiwc', 'pets'))
    expect(p.petsBuiltinDir).toBe(join('/repo', 'resources', 'pets'))
  })

  it('uses process.resourcesPath for native + builtin skills when packaged', () => {
    const p = createPaths({
      userData: dir,
      isPackaged: true,
      resourcesPath: '/App/Contents/Resources',
      appPath: '/App/Contents/Resources/app.asar',
      platform: 'win32',
      arch: 'x64',
    })
    expect(p.nativeDir).toBe(join('/App/Contents/Resources', 'resources', 'native', 'win32-x64'))
    expect(p.skillsBuiltinDir).toBe(join('/App/Contents/Resources', 'skills'))
    expect(platformArchKey('win32', 'x64')).toBe('win32-x64')
  })

  it('ensureDirs creates every directory idempotently and allow-list roots include cache dir', () => {
    const p = createPaths({
      userData: dir,
      isPackaged: false,
      resourcesPath: '',
      appPath: dir,
      platform: 'darwin',
      arch: 'arm64',
    })
    ensureDirs(p)
    ensureDirs(p)
    for (const d of [
      p.petsDir,
      p.rolloutsDir,
      p.memoryDir,
      p.relationshipsDir,
      p.todoDir,
      p.skillsUserDir,
      p.skillsAgentDir,
      p.mediaCacheDir,
      p.logsDir,
      p.workspaceDir,
      p.tasksDir,
    ]) {
      expect(existsSync(d)).toBe(true)
    }
    expect(defaultAllowedRoots(p, { cacheDir: '/Volumes/ext/cache' })).toEqual([
      p.dataRoot,
      p.cacheDir,
      '/Volumes/ext/cache',
    ])
    expect(defaultAllowedRoots(p, { cacheDir: p.cacheDir })).toEqual([p.dataRoot, p.cacheDir])
  })

  it('keeps the user data and the plaintext databases out of the shell tool, and the workspace in it', () => {
    const p = createPaths({
      userData: dir,
      isPackaged: false,
      resourcesPath: '/unused',
      appPath: '/repo',
      platform: 'darwin',
      arch: 'arm64',
    })
    const protectedPaths = protectedDataPaths(p)

    // Conversation history, memory, clone dossiers, todos (and old diaries), the key store and the channel token.
    for (const secret of [
      decryptedCopyDir(p.cacheDir),
      p.secretsFile,
      p.configFile,
      p.mirrorDb,
      p.indexDb,
      p.recordsDb,
      p.usageDb,
      p.rolloutsDir,
      p.memoryDir,
      p.relationshipsDir,
      p.todoDir,
      p.legacyDiariesDir,
      p.gatewayStateDir,
      p.changesDir,
      `${p.mirrorDb}-wal`,
      `${p.usageDb}-shm`,
      extensionsFile(p),
      p.tasksDir,
      p.mobileDir,
      p.composerDraftsFile,
      p.exportsDir,
      p.logsDir,
      resetMarkerFile(p),
    ]) {
      expect(protectedPaths).toContain(secret)
    }
    // Denying these would break the tool itself: the workspace is where it runs.
    expect(protectedPaths).not.toContain(p.workspaceDir)
    expect(protectedPaths).not.toContain(p.dataRoot)
    // Everything is inside userData: the data root, or the reset marker right beside it.
    expect(protectedPaths.every((entry) => entry.startsWith(dir))).toBe(true)
    expect(resetMarkerFile(p)).toBe(join(dir, 'aiwc-reset.json'))
  })

  it('protects the plaintext copies where the engine writes them, including a custom cache dir', () => {
    const p = createPaths({
      userData: dir,
      isPackaged: false,
      resourcesPath: '/unused',
      appPath: '/repo',
      platform: 'darwin',
      arch: 'arm64',
    })
    // Default: the engine gets <cache>/media, so the copies live in <cache>/media/wcdb-plain.
    const engineDefault = substrateCacheDir(p, undefined)
    expect(engineDefault).toBe(p.mediaCacheDir)
    expect(protectedDataPaths(p)).toContain(join(p.cacheDir, 'media', 'wcdb-plain'))
    expect(protectedDataPaths(p)).toContain(decryptedCopyDir(engineDefault))

    // A custom cache dir moves the engine and the protected entry together; the old location stays denied.
    const custom = join(dir, 'custom-cache')
    const engineCustom = substrateCacheDir(p, custom)
    const withCustom = protectedDataPaths(p, custom)
    expect(engineCustom).toBe(custom)
    expect(withCustom).toContain(join(custom, 'wcdb-plain'))
    expect(withCustom).toContain(decryptedCopyDir(p.mediaCacheDir))
    expect(new Set(withCustom).size).toBe(withCustom.length)
  })
})
