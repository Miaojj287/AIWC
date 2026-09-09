import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSecretStore, isValidSecretRef, SECRET_REFS, type SafeStorageLike } from './secretStore'

function fakeSafeStorage(available = true): SafeStorageLike {
  // reversible "encryption" so tests can assert the file never holds plaintext
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s, 'utf8').toString('hex')}`),
    decryptString: (b) => {
      const t = b.toString()
      if (!t.startsWith('enc:')) throw new Error('bad cipher')
      return Buffer.from(t.slice(4), 'hex').toString('utf8')
    },
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-secrets-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('secretStore', () => {
  it('set / has / reveal / delete round-trip, ciphertext only on disk', () => {
    const file = join(dir, 'secrets.bin')
    const store = createSecretStore({ file, safeStorage: fakeSafeStorage() })
    expect(store.has(SECRET_REFS.dbKey)).toBe(false)
    store.set(SECRET_REFS.dbKey, 'a'.repeat(64))
    expect(store.has(SECRET_REFS.dbKey)).toBe(true)
    expect(store.reveal(SECRET_REFS.dbKey)).toBe('a'.repeat(64))
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('a'.repeat(64))
    expect(JSON.parse(raw).version).toBe(1)

    // survives a reload
    const again = createSecretStore({ file, safeStorage: fakeSafeStorage() })
    expect(again.reveal(SECRET_REFS.dbKey)).toBe('a'.repeat(64))
    expect(again.list()).toEqual([SECRET_REFS.dbKey])

    again.delete(SECRET_REFS.dbKey)
    expect(again.has(SECRET_REFS.dbKey)).toBe(false)
    expect(again.reveal(SECRET_REFS.dbKey)).toBeNull()
  })

  it('refuses to store when encryption is unavailable and rejects bad refs', () => {
    const store = createSecretStore({ file: join(dir, 's.bin'), safeStorage: fakeSafeStorage(false) })
    expect(store.available()).toBe(false)
    expect(() => store.set('x', 'y')).toThrow(/safeStorage/)
    const ok = createSecretStore({ file: join(dir, 's2.bin'), safeStorage: fakeSafeStorage() })
    expect(() => ok.set('bad ref with spaces', 'y')).toThrow(/非法/)
    expect(isValidSecretRef(SECRET_REFS.providerApiKey('openai'))).toBe(true)
  })

  it('returns null (not throw) when a ciphertext cannot be decrypted', () => {
    const file = join(dir, 'secrets.bin')
    createSecretStore({ file, safeStorage: fakeSafeStorage() }).set('k', 'v')
    const broken: SafeStorageLike = { ...fakeSafeStorage(), decryptString: () => { throw new Error('keychain changed') } }
    expect(createSecretStore({ file, safeStorage: broken }).reveal('k')).toBeNull()
  })

  it('keeps session-only refs in memory and removes older persisted values', () => {
    const file = join(dir, 'secrets.bin')
    const persistent = createSecretStore({ file, safeStorage: fakeSafeStorage() })
    persistent.set(SECRET_REFS.dbKey, 'old-db-key')
    persistent.set('ai.provider.openai.apiKey', 'provider-key')

    const store = createSecretStore({ file, safeStorage: fakeSafeStorage(), sessionOnlyRefs: [SECRET_REFS.dbKey] })
    expect(store.has(SECRET_REFS.dbKey)).toBe(false)
    expect(store.reveal('ai.provider.openai.apiKey')).toBe('provider-key')

    store.set(SECRET_REFS.dbKey, 'current-db-key')
    expect(store.reveal(SECRET_REFS.dbKey)).toBe('current-db-key')
    const again = createSecretStore({ file, safeStorage: fakeSafeStorage(), sessionOnlyRefs: [SECRET_REFS.dbKey] })
    expect(again.has(SECRET_REFS.dbKey)).toBe(false)
    expect(again.reveal('ai.provider.openai.apiKey')).toBe('provider-key')
  })
})
