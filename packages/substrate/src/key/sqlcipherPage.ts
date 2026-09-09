/**
 * SQLCipher 4 page-format helpers for WeChat 4.x databases (page 4096, reserved 80, PBKDF2-SHA512 256k).
 * Lets us validate a key and tell "raw" keys (need PBKDF2) from "direct" keys (already derived) without
 * loading any native library. Also used by the WCDB bridge to pick the right cipher form.
 */
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'

export const SQLCIPHER_PAGE_SIZE = 4096
export const SQLCIPHER_SALT_SIZE = 16
export const SQLCIPHER_RESERVED_SIZE = 80
export const SQLCIPHER_KDF_ITERATIONS = 256_000
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1')

export type DbKeyForm = 'raw' | 'direct' | 'plaintext'

export function readFirstPage(dbPath: string): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(dbPath, 'r')
    const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    const read = readSync(fd, page, 0, page.length, 0)
    return read === SQLCIPHER_PAGE_SIZE ? page : null
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export function isPlaintextSqlitePage(page: Buffer): boolean {
  return page.length >= SQLITE_HEADER.length && page.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)
}

/** PBKDF2-SHA512 (256 000 rounds) — the SQLCipher 4 default WeChat relies on. */
export function deriveSqlcipherKey(rawKey: Buffer, salt: Buffer): Buffer {
  return pbkdf2Sync(rawKey, salt, SQLCIPHER_KDF_ITERATIONS, 32, 'sha512')
}

/**
 * Decrypt the body of page 1 (bytes 16..PAGE-80) with AES-256-CBC. The IV sits in the reserved tail.
 * Returns the plaintext body starting at what would be file offset 16 (page size field).
 */
export function decryptFirstPageBody(page: Buffer, key: Buffer): Buffer | null {
  if (page.length !== SQLCIPHER_PAGE_SIZE || key.length !== 32) return null
  try {
    const ivOffset = SQLCIPHER_PAGE_SIZE - SQLCIPHER_RESERVED_SIZE
    const decipher = createDecipheriv('aes-256-cbc', key, page.subarray(ivOffset, ivOffset + 16))
    decipher.setAutoPadding(false)
    return Buffer.concat([decipher.update(page.subarray(SQLCIPHER_SALT_SIZE, ivOffset)), decipher.final()])
  } catch {
    return null
  }
}

/** Sanity-check the decrypted header fields right after the 16-byte magic. */
export function looksLikeSqliteHeaderBody(body: Buffer): boolean {
  if (body.length < 8) return false
  return (
    body[0] === 0x10 && body[1] === 0x00 && // page size 4096
    (body[2] === 1 || body[2] === 2) && (body[3] === 1 || body[3] === 2) && // write/read versions
    body[4] === SQLCIPHER_RESERVED_SIZE && body[5] === 0x40 && body[6] === 0x20 && body[7] === 0x20
  )
}

export function isValidKeyHex(hex: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(hex)
}

/**
 * Classify a 64-hex key against an encrypted first page:
 *  - 'direct' when the bytes decrypt page 1 as-is (already PBKDF2-derived, e.g. Windows Config.Cipher)
 *  - 'raw' when PBKDF2(key, salt) decrypts it (the in-memory account key WeChat hands to WCDB)
 *  - null when neither works
 */
export function classifyKeyAgainstPage(page: Buffer, hexKey: string): DbKeyForm | null {
  if (!isValidKeyHex(hexKey)) return null
  if (isPlaintextSqlitePage(page)) return 'plaintext'
  const candidate = Buffer.from(hexKey, 'hex')
  const direct = decryptFirstPageBody(page, candidate)
  if (direct && looksLikeSqliteHeaderBody(direct)) return 'direct'
  const derived = deriveSqlcipherKey(candidate, page.subarray(0, SQLCIPHER_SALT_SIZE))
  const viaKdf = decryptFirstPageBody(page, derived)
  if (viaKdf && looksLikeSqliteHeaderBody(viaKdf)) return 'raw'
  return null
}

export interface DbKeyVerification {
  ok: boolean
  form?: DbKeyForm
  error?: string
}

/** Verify a key against a database file on disk (pure TypeScript, ~150 ms for the PBKDF2 path). */
export function verifyDbKey(dbPath: string, hexKey: string): DbKeyVerification {
  const normalized = hexKey.trim().toLowerCase()
  if (!isValidKeyHex(normalized)) return { ok: false, error: '数据库密钥必须是 64 位十六进制字符串' }
  const page = readFirstPage(dbPath)
  if (!page) return { ok: false, error: `无法读取数据库首页: ${dbPath}` }
  const form = classifyKeyAgainstPage(page, normalized)
  if (!form) return { ok: false, error: '密钥与数据库不匹配' }
  return { ok: true, form }
}

/** 16-byte salt (first page prefix) of an encrypted db, hex — null for plaintext / unreadable. */
export function readEncryptedDbSalt(dbPath: string): string | null {
  const page = readFirstPage(dbPath)
  if (!page || isPlaintextSqlitePage(page)) return null
  return page.subarray(0, SQLCIPHER_SALT_SIZE).toString('hex')
}
