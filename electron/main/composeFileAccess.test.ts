import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '@aiwc/protocol'
import { decryptedCopyDir } from '@aiwc/substrate'
import { composeFileAccess } from './composeFileAccess'
import { createPaths } from './paths'

vi.mock('./i18n', () => ({ t: (key: string) => key }))

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('composeFileAccess', () => {
  it('protects a custom cache dir set after startup, and ignores an invalid one', () => {
    const root = mkdtempSync(join(tmpdir(), 'aiwc-access-'))
    dirs.push(root)
    const paths = createPaths({
      userData: root,
      isPackaged: false,
      resourcesPath: root,
      appPath: root,
      platform: 'darwin',
      arch: 'arm64',
    })
    let cacheDir = ''
    const config = () => ({ account: { cacheDir } }) as unknown as AppConfig
    const warn = vi.fn()
    const access = composeFileAccess({ paths, config, log: { warn }, home: '/Users/me' })
    const custom = join(root, 'elsewhere')
    expect(access.protectedPaths()).not.toContain(decryptedCopyDir(custom))
    cacheDir = custom
    expect(access.cacheDirOverride()).toBe(custom)
    expect(access.protectedPaths()).toContain(decryptedCopyDir(custom))
    cacheDir = '/Users/me'
    expect(access.cacheDirOverride()).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    // The allow-list root comes from startup only (no custom dir then).
    expect(access.allowList.isAllowed(join(custom, 'x'))).toBe(false)
    expect(access.allowList.isAllowed(join(paths.dataRoot, 'workspace', 'a.md'))).toBe(true)
  })
})
