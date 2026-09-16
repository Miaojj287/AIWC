/**
 * SQLCipher 4 page codec for WeChat 4.x databases — pure node:crypto, no native library.
 *
 * Every page is 4096 bytes laid out as `[body][IV 16][HMAC-SHA512 64]`, and page 1 starts with the
 * 16-byte KDF salt where a plain SQLite file carries its "SQLite format 3\0" magic. Decrypting a page
 * therefore only needs that page's own IV; the HMAC is an integrity check read-only access can skip.
 *
 * Decrypted pages keep the reserved 80-byte tail as filler, so the resulting file still declares
 * `reserved = 80` in its header and any stock SQLite build reads it unchanged.
 */
import { createDecipheriv } from 'node:crypto'
import {
  classifyKeyAgainstPage,
  deriveSqlcipherKey,
  SQLCIPHER_PAGE_SIZE,
  SQLCIPHER_RESERVED_SIZE,
  SQLCIPHER_SALT_SIZE,
  type DbKeyForm,
} from '../key/sqlcipherPage'

/** Magic of a plain SQLite file; SQLCipher overwrites it with the KDF salt. */
export const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')
/** Where the reserved tail (IV + HMAC) starts inside a page. */
export const PAGE_BODY_END = SQLCIPHER_PAGE_SIZE - SQLCIPHER_RESERVED_SIZE
export const PAGE_IV_SIZE = 16
/** Header bytes 18/19 — file format write/read version: 1 = rollback journal, 2 = WAL. */
const HEADER_WRITE_VERSION_OFFSET = 18
const HEADER_READ_VERSION_OFFSET = 19
const JOURNAL_MODE_LEGACY = 1

export interface PageCipher {
  /** The 32-byte AES key SQLCipher uses per page ('plaintext' databases leave this empty). */
  readonly key: Buffer
  readonly form: DbKeyForm
  /** Hex of the database's 16-byte KDF salt; empty for plaintext databases. */
  readonly saltHex: string
}

/**
 * Turn the 64-hex key the key scanner recovered into the AES key this database's pages use.
 * WeChat hands out two shapes (see classifyKeyAgainstPage) that both resolve to the same AES key:
 * a 'raw' passphrase still needing PBKDF2, or an already-derived 'direct' key. Returns null when the
 * key does not match the page at all.
 */
export function resolvePageCipher(firstPage: Buffer, keyHex: string): PageCipher | null {
  const form = classifyKeyAgainstPage(firstPage, keyHex)
  if (!form) return null
  if (form === 'plaintext') return { key: Buffer.alloc(0), form, saltHex: '' }
  const salt = firstPage.subarray(0, SQLCIPHER_SALT_SIZE)
  const raw = Buffer.from(keyHex, 'hex')
  return {
    key: form === 'direct' ? raw : deriveSqlcipherKey(raw, salt),
    form,
    saltHex: salt.toString('hex'),
  }
}

/**
 * Decrypt one page of `source` into `target` at `targetOffset`. Page 1 gets its SQLite magic back and
 * is marked as a rollback-journal database, because we apply WAL frames ourselves and a read-only
 * SQLite connection cannot open a WAL database without its -wal / -shm companions.
 *
 * Returns false when the page is too short or the cipher rejects it; callers treat that as a torn read.
 */
export function decryptPageInto(
  source: Buffer,
  key: Buffer,
  pageNumber: number,
  target: Buffer,
  targetOffset: number,
): boolean {
  if (source.length !== SQLCIPHER_PAGE_SIZE || key.length !== 32 || pageNumber < 1) return false
  if (targetOffset + SQLCIPHER_PAGE_SIZE > target.length) return false
  const bodyStart = pageNumber === 1 ? SQLCIPHER_SALT_SIZE : 0
  const iv = source.subarray(PAGE_BODY_END, PAGE_BODY_END + PAGE_IV_SIZE)
  let body: Buffer
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    decipher.setAutoPadding(false)
    body = Buffer.concat([decipher.update(source.subarray(bodyStart, PAGE_BODY_END)), decipher.final()])
  } catch {
    return false
  }
  if (pageNumber === 1) SQLITE_MAGIC.copy(target, targetOffset)
  body.copy(target, targetOffset + bodyStart)
  // The tail is unused by SQLite; keeping it lets a refresh detect rewritten pages by their IV.
  source.subarray(PAGE_BODY_END).copy(target, targetOffset + PAGE_BODY_END)
  if (pageNumber === 1) {
    target[targetOffset + HEADER_WRITE_VERSION_OFFSET] = JOURNAL_MODE_LEGACY
    target[targetOffset + HEADER_READ_VERSION_OFFSET] = JOURNAL_MODE_LEGACY
  }
  return true
}
