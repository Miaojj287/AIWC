import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import { resolvePageCipher, pageHmacMatches, type PageCipher } from '../wcdb/sqlcipherCodec'
import { authenticatedMainPageCount } from '../wcdb/sqlitePageExtent'
import { SQLCIPHER_PAGE_SIZE, SQLCIPHER_SALT_SIZE } from './sqlcipherPage'
import type { MemoryDbKeyCandidate } from './memoryDbKeyPattern'

const UNAVAILABLE_FILE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EIO'])

interface DatabaseSample {
  relativePath: string
  path: string
  size: number
  salt: string
  firstPage: Buffer
}

function sampleDatabase(root: string, path: string): DatabaseSample | undefined {
  const inside = relative(root, realpathSync(path))
  if (!inside || isAbsolute(inside) || inside.split(sep).some((part) => part === '..' || part === '.')) return undefined
  const descriptor = openSync(path, 'r')
  try {
    const size = fstatSync(descriptor).size
    if (size < SQLCIPHER_PAGE_SIZE || size % SQLCIPHER_PAGE_SIZE !== 0) return undefined
    const firstPage = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    if (readSync(descriptor, firstPage, 0, firstPage.length, 0) !== firstPage.length) return undefined
    return {
      relativePath: inside.split(sep).join('/'),
      path,
      size,
      salt: firstPage.subarray(0, SQLCIPHER_SALT_SIZE).toString('hex'),
      firstPage,
    }
  } finally {
    closeSync(descriptor)
  }
}

function sampleAvailableDatabase(
  root: string,
  path: string,
  onUnavailable?: (code: string) => void,
): DatabaseSample | undefined {
  try {
    return sampleDatabase(root, path)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (typeof code !== 'string' || !UNAVAILABLE_FILE_CODES.has(code)) throw error
    onUnavailable?.(code)
    return undefined
  }
}

function sampleLogicalPages(sample: DatabaseSample, cipher: PageCipher): boolean {
  const pages = authenticatedMainPageCount(sample.firstPage, cipher, sample.size)
  const hmacKey = cipher.hmacKey
  if (pages === undefined || !hmacKey) return false
  const descriptor = openSync(sample.path, 'r')
  const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
  try {
    if (fstatSync(descriptor).size !== sample.size) return false
    // Physical EOF may be uninitialized Windows preallocation, outside the authenticated SQLite size.
    for (const number of new Set([Math.min(2, pages), pages])) {
      if (number === 1) continue
      if (readSync(descriptor, page, 0, page.length, (number - 1) * SQLCIPHER_PAGE_SIZE) !== page.length) return false
      if (!pageHmacMatches(hmacKey, page, number)) return false
    }
    return true
  } finally {
    page.fill(0)
    closeSync(descriptor)
  }
}

function availableLogicalPages(
  sample: DatabaseSample,
  cipher: PageCipher,
  onUnavailable?: (code: string) => void,
): boolean {
  try {
    return sampleLogicalPages(sample, cipher)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (typeof code !== 'string' || !UNAVAILABLE_FILE_CODES.has(code)) throw error
    onUnavailable?.(code)
    return false
  }
}

/** Match one candidate pool using salt, AES structure, and MACs through the authenticated logical end. */
export function createWindowsCredentialMatcher(
  storage: string,
  targets: readonly string[],
  onUnavailable?: (code: string) => void,
) {
  const root = realpathSync(storage)
  const samples = targets
    .map((path) => sampleAvailableDatabase(root, path, onUnavailable))
    .filter((sample): sample is DatabaseSample => !!sample)
  const entries = new Map<string, WechatDbCredentialBundle['entries'][number]>()
  const tested = new Set<string>()
  return {
    offer(candidate: MemoryDbKeyCandidate): void {
      const identity = `${candidate.key}:${candidate.salt}`
      if (tested.has(identity)) return
      tested.add(identity)
      for (const sample of samples) {
        if (entries.has(sample.relativePath) || sample.salt !== candidate.salt) continue
        const cipher = resolvePageCipher(sample.firstPage, candidate.key)
        try {
          const hmacKey = cipher?.hmacKey
          if (!cipher || !hmacKey || cipher.form === 'plaintext') continue
          if (!availableLogicalPages(sample, cipher, onUnavailable)) continue
          entries.set(sample.relativePath, {
            relativePath: sample.relativePath,
            keyHex: candidate.key,
            saltHex: sample.salt,
            form: cipher.form,
          })
        } finally {
          cipher?.key.fill(0)
          cipher?.hmacKey?.fill(0)
        }
      }
    },
    get complete(): boolean {
      return entries.size === targets.length
    },
    bundle(accountId: string): WechatDbCredentialBundle | undefined {
      return entries.size ? { version: 1, accountId, entries: [...entries.values()] } : undefined
    },
    clear(): void {
      tested.clear()
      entries.clear()
      for (const sample of samples) sample.firstPage.fill(0)
    },
  }
}
