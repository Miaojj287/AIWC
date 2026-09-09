import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CACHE_DIR_ERRORS, customCacheDir, isDirectorySync, validateCacheDir } from './cacheDirPolicy'
import { createAllowList } from './pathAllowList'

const home = '/Users/me'
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-cachedir-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('cacheDir policy', () => {
  it('treats empty / whitespace as "use the default"', () => {
    expect(customCacheDir(undefined)).toBeUndefined()
    expect(customCacheDir('')).toBeUndefined()
    expect(customCacheDir('   ')).toBeUndefined()
    expect(customCacheDir(' /data/x ')).toBe('/data/x')
  })

  it('rejects relative paths, the filesystem root and home', () => {
    expect(validateCacheDir('cache', { home })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.notAbsolute })
    expect(validateCacheDir('/', { home })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.forbiddenRoot })
    expect(validateCacheDir('/Users/me/', { home })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.forbiddenRoot })
    expect(validateCacheDir('/Users/me/../me', { home })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.forbiddenRoot })
    expect(validateCacheDir('/data/a\0b', { home })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.notAbsolute })
  })

  it('with an allow-list, only already-allowed directories pass (no privilege escalation)', () => {
    const al = createAllowList(['/data/aiwc'], { home })
    expect(validateCacheDir('/Volumes/ext/cache', { home, allowList: al })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.notAllowed })
    expect(validateCacheDir('/data/aiwc/cache', { home, allowList: al })).toEqual({ ok: true, dir: '/data/aiwc/cache' })
    // a directory the user picked through the dialog becomes allowed, so it may now be the cache dir
    expect(al.addRoot('/Volumes/ext/cache')).toBe(true)
    expect(validateCacheDir('/Volumes/ext/cache/', { home, allowList: al })).toEqual({ ok: true, dir: '/Volumes/ext/cache' })
    // …but picking cannot smuggle in '/' or home either
    expect(al.addRoot('/')).toBe(false)
    expect(validateCacheDir('/etc', { home, allowList: al })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.notAllowed })
  })

  it('startup validation requires an existing directory', () => {
    expect(validateCacheDir(dir, { home, isDirectory: isDirectorySync })).toEqual({ ok: true, dir })
    expect(validateCacheDir(join(dir, 'missing'), { home, isDirectory: isDirectorySync })).toEqual({ ok: false, reason: CACHE_DIR_ERRORS.missing })
    expect(isDirectorySync(join(dir, 'missing'))).toBe(false)
  })
})
