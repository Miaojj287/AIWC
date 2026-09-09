import { afterAll, describe, expect, it } from 'vitest'
import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SQLCIPHER_PAGE_SIZE,
  SQLCIPHER_RESERVED_SIZE,
  classifyKeyAgainstPage,
  deriveSqlcipherKey,
  isPlaintextSqlitePage,
  isValidKeyHex,
  readEncryptedDbSalt,
  verifyDbKey,
} from './sqlcipherPage'

const HEADER_BODY = Buffer.from([0x10, 0x00, 0x01, 0x01, SQLCIPHER_RESERVED_SIZE, 0x40, 0x20, 0x20])

/** Build a valid SQLCipher-4 encrypted first page for `key` (already the 32-byte AES key). */
function buildEncryptedPage(key: Buffer, salt: Buffer): Buffer {
  const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
  const iv = randomBytes(16)
  const bodyLen = SQLCIPHER_PAGE_SIZE - SQLCIPHER_RESERVED_SIZE - 16 // 4000
  const body = Buffer.alloc(bodyLen)
  HEADER_BODY.copy(body, 0)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()])
  salt.copy(page, 0)
  encrypted.copy(page, 16)
  iv.copy(page, SQLCIPHER_PAGE_SIZE - SQLCIPHER_RESERVED_SIZE)
  return page
}

describe('isValidKeyHex', () => {
  it('accepts 64 hex only', () => {
    expect(isValidKeyHex('a'.repeat(64))).toBe(true)
    expect(isValidKeyHex('a'.repeat(63))).toBe(false)
  })
})

describe('classifyKeyAgainstPage', () => {
  const salt = randomBytes(16)
  const rawKey = randomBytes(32)
  const rawKeyHex = rawKey.toString('hex')

  it('classifies a raw key that needs PBKDF2', () => {
    const derived = deriveSqlcipherKey(rawKey, salt)
    const page = buildEncryptedPage(derived, salt)
    expect(classifyKeyAgainstPage(page, rawKeyHex)).toBe('raw')
  })

  it('classifies a direct (already-derived) key', () => {
    const directKey = randomBytes(32)
    const page = buildEncryptedPage(directKey, salt)
    expect(classifyKeyAgainstPage(page, directKey.toString('hex'))).toBe('direct')
  })

  it('returns null for the wrong key', () => {
    const derived = deriveSqlcipherKey(rawKey, salt)
    const page = buildEncryptedPage(derived, salt)
    expect(classifyKeyAgainstPage(page, 'b'.repeat(64))).toBeNull()
  })
})

describe('plaintext detection and salt reading', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-sqlcipher-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('detects plaintext sqlite headers', () => {
    const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    Buffer.from('SQLite format 3\0', 'latin1').copy(page, 0)
    expect(isPlaintextSqlitePage(page)).toBe(true)
  })

  it('reads the salt of an encrypted db and verifies a raw key', () => {
    const salt = randomBytes(16)
    const rawKey = randomBytes(32)
    const derived = deriveSqlcipherKey(rawKey, salt)
    const page = buildEncryptedPage(derived, salt)
    const dbPath = join(dir, 'session.db')
    writeFileSync(dbPath, page)
    expect(readEncryptedDbSalt(dbPath)).toBe(salt.toString('hex'))
    expect(verifyDbKey(dbPath, rawKey.toString('hex'))).toMatchObject({ ok: true, form: 'raw' })
    expect(verifyDbKey(dbPath, 'c'.repeat(64)).ok).toBe(false)
  })

  it('returns null salt for a plaintext db', () => {
    const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    Buffer.from('SQLite format 3\0', 'latin1').copy(page, 0)
    const dbPath = join(dir, 'plain.db')
    writeFileSync(dbPath, page)
    expect(readEncryptedDbSalt(dbPath)).toBeNull()
  })
})
