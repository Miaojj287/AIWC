import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWcdbBridge } from './engine'
import { wcdbLibraryName } from './nativeLib'

const ORIGINAL_ENGINE = process.env.AIWC_WCDB_ENGINE

let nativeDir = ''
let cacheDir = ''

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-engine-'))
  nativeDir = join(root, 'native')
  cacheDir = join(root, 'cache')
  mkdirSync(nativeDir, { recursive: true })
})

afterEach(() => {
  if (ORIGINAL_ENGINE === undefined) delete process.env.AIWC_WCDB_ENGINE
  else process.env.AIWC_WCDB_ENGINE = ORIGINAL_ENGINE
})

describe('createWcdbBridge', () => {
  it('uses the SQLCipher engine when no WCDB build is bundled for this platform', () => {
    // Windows ships no WCDB build; before the fallback existed this threw NativeMissingError and the
    // account could not be opened at all even though its key had been recovered.
    const { bridge, engine } = createWcdbBridge({ nativeDir, cacheDir })
    expect(engine).toBe('sqlcipher')
    bridge.dispose()
  })

  it('falls back instead of failing when a bundled library cannot be loaded', () => {
    writeFileSync(join(nativeDir, wcdbLibraryName()), 'not a shared library')
    const { bridge, engine } = createWcdbBridge({ nativeDir, cacheDir })
    expect(engine).toBe('sqlcipher')
    bridge.dispose()
  })

  it('reports the missing component when the native engine is pinned', () => {
    process.env.AIWC_WCDB_ENGINE = 'wcdb'
    expect(() => createWcdbBridge({ nativeDir, cacheDir })).toThrow(wcdbLibraryName())
  })

  it('honours a pinned SQLCipher engine even when a library is present', () => {
    process.env.AIWC_WCDB_ENGINE = 'sqlcipher'
    writeFileSync(join(nativeDir, wcdbLibraryName()), 'not a shared library')
    const { bridge, engine } = createWcdbBridge({ nativeDir, cacheDir })
    expect(engine).toBe('sqlcipher')
    bridge.dispose()
  })
})
