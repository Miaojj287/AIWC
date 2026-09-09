/**
 * Secret store: `ref` → ciphertext produced by electron.safeStorage (OS keychain-backed key).
 * On disk: secrets.bin = JSON { version: 1, entries: { [ref]: base64(ciphertext) } }, mode 0600.
 * The safeStorage-like object is injected so tests can use a fake; the module never imports electron.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Logger } from '../log'
import { nullLogger } from '../log'

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
  imageXorKey: 'account.imageXorKey',
  imageAesKey: 'account.imageAesKey',
  providerApiKey: (providerId: string) => `ai.provider.${providerId}.apiKey`,
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
  if (removedPersistedSessionSecret) persist()

  function load(): SecretsFile {
    if (!existsSync(opts.file)) return { version: 1, entries: {} }
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as Partial<SecretsFile>
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        return { version: 1, entries: { ...parsed.entries } }
      }
      log.warn('secrets.bin 结构无效，重新开始')
    } catch (e) {
      log.error('secrets.bin 无法解析，已备份', e)
      try {
        renameSync(opts.file, `${opts.file}.bak-${Date.now()}`)
      } catch {
        // ignore
      }
    }
    return { version: 1, entries: {} }
  }

  function persist(): void {
    mkdirSync(dirname(opts.file), { recursive: true })
    const tmp = `${opts.file}.${process.pid}.tmp`
    const entries = Object.fromEntries(Object.entries(data.entries).filter(([ref]) => !sessionOnlyRefs.has(ref)))
    writeFileSync(tmp, JSON.stringify({ ...data, entries }), { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(tmp, 0o600)
    } catch {
      // Windows: mode bits are not supported; ACL of userData protects the file
    }
    renameSync(tmp, opts.file)
  }

  function assertRef(ref: string): void {
    if (!isValidSecretRef(ref)) throw new Error(`非法的密钥引用: ${ref}`)
  }

  return {
    available: () => opts.safeStorage.isEncryptionAvailable(),
    has(ref) {
      return Object.prototype.hasOwnProperty.call(data.entries, ref)
    },
    set(ref, value) {
      assertRef(ref)
      if (!opts.safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统无法安全加密密钥（safeStorage 不可用）')
      }
      const cipher = opts.safeStorage.encryptString(value)
      data.entries[ref] = cipher.toString('base64')
      persist()
    },
    reveal(ref) {
      const b64 = data.entries[ref]
      if (b64 === undefined) return null
      try {
        return opts.safeStorage.decryptString(Buffer.from(b64, 'base64'))
      } catch (e) {
        log.error(`解密失败: ${ref}`, e)
        return null
      }
    },
    delete(ref) {
      if (!(ref in data.entries)) return
      delete data.entries[ref]
      persist()
    },
    list() {
      return Object.keys(data.entries).sort()
    },
  }
}
