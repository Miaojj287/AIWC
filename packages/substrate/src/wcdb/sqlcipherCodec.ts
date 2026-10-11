/**
 * SQLCipher 4 page codec for WeChat 4.x databases — pure node:crypto, no native library.
 *
 * Every page is 4096 bytes laid out as `[body][IV 16][HMAC-SHA512 64]`, and page 1 starts with the
 * 16-byte KDF salt where a plain SQLite file carries its "SQLite format 3\0" magic. Decrypting a page
 * needs that page's own IV; the HMAC authenticates the ciphertext, the IV and the page number, which
 * is the only way to tell a good page from one read while WeChat was rewriting it (AES-CBC without
 * padding never rejects anything, so an unverified page decrypts to silent garbage).
 *
 * Decrypted pages keep the reserved 80-byte tail as filler, so the resulting file still declares
 * `reserved = 80` in its header and any stock SQLite build reads it unchanged.
 */
import { createDecipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
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
/** Where the 64-byte HMAC-SHA512 sits: right behind the IV, filling the rest of the reserved tail. */
export const PAGE_HMAC_START = PAGE_BODY_END + PAGE_IV_SIZE
const PAGE_HMAC_SIZE = SQLCIPHER_RESERVED_SIZE - PAGE_IV_SIZE
/** SQLCipher derives the HMAC key from the AES key with the KDF salt inverted by this mask. */
const HMAC_SALT_MASK = 0x3a
/** `fast_kdf_iter`: the HMAC key only has to be distinct from the AES key, not slow to derive. */
const HMAC_KDF_ITERATIONS = 2
const AES_KEY_SIZE = 32

export interface PageKeys {
  /** The 32-byte AES key SQLCipher uses per page ('plaintext' databases leave this empty). */
  readonly key: Buffer
  /**
   * The 32-byte per-page HMAC key, or null when this database's pages do not authenticate with the
   * SQLCipher 4 defaults — `cipher_use_hmac=OFF`, or a build whose HMAC parameters we do not model.
   * It is proven against page 1 in `resolvePageCipher`, so an unexpected build degrades to
   * decrypt-only (today's behaviour) instead of refusing every page.
   */
  readonly hmacKey: Buffer | null
}

export interface PageCipher extends PageKeys {
  readonly form: DbKeyForm
  /** Hex of the database's 16-byte KDF salt; empty for plaintext databases. */
  readonly saltHex: string
}

/**
 * SQLCipher's HMAC key: PBKDF2-SHA512 over the AES key, salted with the KDF salt XOR 0x3a and only
 * `fast_kdf_iter` rounds. Output length is the cipher's key size (32), not the digest size.
 */
export function deriveSqlcipherHmacKey(aesKey: Buffer, salt: Buffer): Buffer {
  const hmacSalt = Buffer.alloc(salt.length)
  for (let index = 0; index < salt.length; index += 1) hmacSalt[index] = (salt[index] ?? 0) ^ HMAC_SALT_MASK
  return pbkdf2Sync(aesKey, hmacSalt, HMAC_KDF_ITERATIONS, AES_KEY_SIZE, 'sha512')
}

/**
 * The HMAC SQLCipher stores for one page: HMAC-SHA512 over `ciphertext || IV || pageNumber`, the page
 * number as a little-endian uint32. Including the IV and the page number is what makes a spliced IV
 * or a resequenced page detectable, which the IV-only freshness check cannot see.
 */
export function pageHmac(hmacKey: Buffer, page: Buffer, pageNumber: number): Buffer {
  const pageNumberLe = Buffer.alloc(4)
  pageNumberLe.writeUInt32LE(pageNumber >>> 0)
  return createHmac('sha512', hmacKey)
    .update(page.subarray(pageNumber === 1 ? SQLCIPHER_SALT_SIZE : 0, PAGE_HMAC_START))
    .update(pageNumberLe)
    .digest()
}

/** True when the page still carries the HMAC SQLCipher wrote for it. */
export function pageHmacMatches(hmacKey: Buffer, page: Buffer, pageNumber: number): boolean {
  const stored = page.subarray(PAGE_HMAC_START, PAGE_HMAC_START + PAGE_HMAC_SIZE)
  if (stored.length !== PAGE_HMAC_SIZE) return false
  return timingSafeEqual(pageHmac(hmacKey, page, pageNumber), stored)
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
  if (form === 'plaintext') return { key: Buffer.alloc(0), form, saltHex: '', hmacKey: null }
  const salt = firstPage.subarray(0, SQLCIPHER_SALT_SIZE)
  const raw = Buffer.from(keyHex, 'hex')
  const key = form === 'direct' ? raw : deriveSqlcipherKey(raw, salt)
  const hmacKey = deriveSqlcipherHmacKey(key, salt)
  return {
    key,
    form,
    saltHex: salt.toString('hex'),
    hmacKey: pageHmacMatches(hmacKey, firstPage, 1) ? hmacKey : null,
  }
}

/**
 * Decrypt one page of `source` into `target` at `targetOffset`. Page 1 gets its SQLite magic back and
 * is marked as a rollback-journal database, because we apply WAL frames ourselves and a read-only
 * SQLite connection cannot open a WAL database without its -wal / -shm companions.
 *
 * Returns false when the page is too short, the arguments do not fit, or the page fails to
 * authenticate. Callers treat that as a torn or tampered read: the page is neither written into the
 * copy nor remembered, so the next refresh reads it again.
 */
export function decryptPageInto(
  source: Buffer,
  cipher: PageKeys,
  pageNumber: number,
  target: Buffer,
  targetOffset: number,
): boolean {
  if (source.length !== SQLCIPHER_PAGE_SIZE || cipher.key.length !== AES_KEY_SIZE || pageNumber < 1) return false
  if (targetOffset + SQLCIPHER_PAGE_SIZE > target.length) return false
  if (cipher.hmacKey && !pageHmacMatches(cipher.hmacKey, source, pageNumber)) return false
  const bodyStart = pageNumber === 1 ? SQLCIPHER_SALT_SIZE : 0
  const iv = source.subarray(PAGE_BODY_END, PAGE_BODY_END + PAGE_IV_SIZE)
  let body: Buffer
  try {
    const decipher = createDecipheriv('aes-256-cbc', cipher.key, iv)
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
