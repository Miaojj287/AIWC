import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPaths, defaultAllowedRoots, ensureDirs, platformArchKey } from './paths'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-paths-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('paths', () => {
  it('lays out the data root under <userData>/aiwc and resolves dev resources from appPath', () => {
    const p = createPaths({ userData: dir, isPackaged: false, resourcesPath: '/unused', appPath: '/repo', platform: 'darwin', arch: 'arm64' })
    expect(p.dataRoot).toBe(join(dir, 'aiwc'))
    expect(p.configFile).toBe(join(dir, 'aiwc', 'config.json'))
    expect(p.secretsFile).toBe(join(dir, 'aiwc', 'secrets.bin'))
    expect(p.mediaCacheDir).toBe(join(dir, 'aiwc', 'cache', 'media'))
    expect(p.mainLogFile).toBe(join(dir, 'aiwc', 'logs', 'main.log'))
    expect(p.skillsUserDir).toBe(join(dir, 'aiwc', 'skills', 'user'))
    expect(p.nativeDir).toBe(join('/repo', 'resources', 'native', 'darwin-arm64'))
    expect(p.skillsBuiltinDir).toBe(join('/repo', 'skills'))
  })

  it('uses process.resourcesPath for native + builtin skills when packaged', () => {
    const p = createPaths({ userData: dir, isPackaged: true, resourcesPath: '/App/Contents/Resources', appPath: '/App/Contents/Resources/app.asar', platform: 'win32', arch: 'x64' })
    expect(p.nativeDir).toBe(join('/App/Contents/Resources', 'resources', 'native', 'win32-x64'))
    expect(p.skillsBuiltinDir).toBe(join('/App/Contents/Resources', 'skills'))
    expect(platformArchKey('win32', 'x64')).toBe('win32-x64')
  })

  it('ensureDirs creates every directory idempotently and allow-list roots include cache dir', () => {
    const p = createPaths({ userData: dir, isPackaged: false, resourcesPath: '', appPath: dir, platform: 'darwin', arch: 'arm64' })
    ensureDirs(p)
    ensureDirs(p)
    for (const d of [p.rolloutsDir, p.memoryDir, p.relationshipsDir, p.diariesDir, p.skillsUserDir, p.skillsAgentDir, p.mediaCacheDir, p.logsDir]) {
      expect(existsSync(d)).toBe(true)
    }
    expect(defaultAllowedRoots(p, { cacheDir: '/Volumes/ext/cache' })).toEqual([p.dataRoot, p.cacheDir, '/Volumes/ext/cache'])
    expect(defaultAllowedRoots(p, { cacheDir: p.cacheDir })).toEqual([p.dataRoot, p.cacheDir])
  })
})
