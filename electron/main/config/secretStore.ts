/**
 * Secret store: `ref` → ciphertext produced by electron.safeStorage (OS keychain-backed key).
 * On disk: secrets.bin = JSON { version: 1, entries: { [ref]: base64(ciphertext) } }, mode 0600.
 * The safeStorage-like object is injected so tests can use a fake; the module never imports electron.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Logger } from '../log'
import { nullLogger } from '../log'
import { t } from '../i18n'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface SecretStore {
  has(ref: string): boolean
  set(ref: string, value: string): void
  /** Plaintext, or null when missing / undecryptable. */
  reveal(ref: string): string | null
  delete(ref: string): void
  list(): string[]
  /** True when the OS backend can encrypt (false on e.g. Linux without a keyring). */
  available(): boolean
}

export interface SecretStoreOptions {
  file: string
  safeStorage: SafeStorageLike
  logger?: Logger
  /** These refs remain usable for the current process but are never loaded from or written to disk. */
  sessionOnlyRefs?: readonly string[]
}

interface SecretsFile {
  version: 1
  entries: Record<string, string>
}

const REF_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

export function isValidSecretRef(ref: string): boolean {
  return REF_PATTERN.test(ref)
}

/** Conventional refs used by the composition root / settings UI. */
export const SECRET_REFS = {
  dbKey: 'account.dbKey',
  dbCredentials: 'account.databaseCredentials.v1',
  imageXorKey: 'account.imageXorKey',
  imageAesKey: 'account.imageAesKey',
  providerApiKey: (providerId: string) => `ai.provider.${providerId}.apiKey`,
  /** TypeSafe (Jev) key for 自动回复的 Jev（beta）回复方式; 设置 › AI 接入 › Jev. */
  jevApiKey: 'ai.jev.apiKey',
} as const

export function createSecretStore(opts: SecretStoreOptions): SecretStore {
  const log = (opts.logger ?? nullLogger).child('secrets')
  const data: SecretsFile = load()
  const sessionOnlyRefs = new Set(opts.sessionOnlyRefs ?? [])

  // Drop credentials left by an older build as soon as the store opens.
  let removedPersistedSessionSecret = false
  for (const ref of sessionOnlyRefs) {
    if (ref in data.entries) {
      delete data.entries[ref]
      removedPersistedSessionSecret = true
    }
  }
  if (removedPersistedSessionSecret) persist(data)

  function load(): SecretsFile {
    if (!existsSync(opts.file)) return { version: 1, entries: {} }
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as Partial<SecretsFile>
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        return { version: 1, entries: { ...parsed.entries } }
      }
      log.warn('secrets.bin has an invalid structure; starting fresh')
    } catch (e) {
      log.error('secrets.bin could not be parsed; backed up', e)
      try {
        renameSync(opts.file, `${opts.file}.bak-${Date.now()}`)
      } catch {
        // ignore
      }
    }
    return { version: 1, entries: {} }
  }

  function persist(next: SecretsFile): void {
    mkdirSync(dirname(opts.file), { recursive: true })
    const tmp = `${opts.file}.${process.pid}.tmp`
    const entries = Object.fromEntries(Object.entries(next.entries).filter(([ref]) => !sessionOnlyRefs.has(ref)))
    try {
      writeFileSync(tmp, JSON.stringify({ ...next, entries }), { encoding: 'utf8', mode: 0o600 })
      try {
        chmodSync(tmp, 0o600)
      } catch {
        // Windows: mode bits are not supported; ACL of userData protects the file.
      }
      renameSync(tmp, opts.file)
    } finally {
      rmSync(tmp, { force: true })
    }
  }

  function assertRef(ref: string): void {
    if (!isValidSecretRef(ref)) throw new Error(t('main.config.invalidSecretRef', { ref }))
  }

  return {
    available: () => opts.safeStorage.isEncryptionAvailable(),
    has(ref) {
      return Object.prototype.hasOwnProperty.call(data.entries, ref)
    },
    set(ref, value) {
      assertRef(ref)
      if (!opts.safeStorage.isEncryptionAvailable()) {
        throw new Error(t('main.config.encryptionUnavailable'))
      }
      const cipher = opts.safeStorage.encryptString(value)
      const next = { ...data, entries: { ...data.entries, [ref]: cipher.toString('base64') } }
      persist(next)
      data.entries = next.entries
    },
    reveal(ref) {
      const b64 = data.entries[ref]
      if (b64 === undefined) return null
      try {
        return opts.safeStorage.decryptString(Buffer.from(b64, 'base64'))
      } catch (e) {
        log.error(`decrypt failed: ${ref}`, e)
        return null
      }
    },
    delete(ref) {
      if (!(ref in data.entries)) return
      const next = { ...data, entries: { ...data.entries } }
      delete next.entries[ref]
      persist(next)
      data.entries = next.entries
    },
    list() {
      return Object.keys(data.entries).sort()
    },
  }
}
