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
  verifyDbKeyAcross,
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

describe('verifyDbKeyAcross', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-account-key-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  /** One database of an account: its own salt, encrypted with `aesKey`. */
  const writeDb = (name: string, aesKey: Buffer, salt: Buffer): string => {
    const dbPath = join(dir, name)
    writeFileSync(dbPath, buildEncryptedPage(aesKey, salt))
    return dbPath
  }

  it('accepts the raw account key against every database, each with its own salt', () => {
    const rawKey = randomBytes(32)
    const files = ['session.db', 'contact.db', 'message_0.db'].map((name) => {
      const salt = randomBytes(16)
      return writeDb(name, deriveSqlcipherKey(rawKey, salt), salt)
    })
    expect(verifyDbKeyAcross(files, rawKey.toString('hex'))).toMatchObject({ ok: true, form: 'raw' })
  })

  it('accepts an account-wide key that SQLCipher uses as is', () => {
    const directKey = randomBytes(32)
    const files = ['direct-session.db', 'direct-message_0.db'].map((name) => writeDb(name, directKey, randomBytes(16)))
    expect(verifyDbKeyAcross(files, directKey.toString('hex'))).toMatchObject({ ok: true, form: 'direct' })
  })

  it('rejects a key that was derived for one database only', () => {
    // The failure mode this check exists for: a key scanned out of WeChat and validated against
    // session.db alone can be that one file's derived key, which cannot read a single message.
    const rawKey = randomBytes(32)
    const sessionSalt = randomBytes(16)
    const sessionKey = deriveSqlcipherKey(rawKey, sessionSalt)
    const session = writeDb('partial-session.db', sessionKey, sessionSalt)
    const shardSalt = randomBytes(16)
    const shard = writeDb('partial-message_0.db', deriveSqlcipherKey(rawKey, shardSalt), shardSalt)

    expect(verifyDbKey(session, sessionKey.toString('hex'))).toMatchObject({ ok: true, form: 'direct' })
    const across = verifyDbKeyAcross([session, shard], sessionKey.toString('hex'))
    expect(across.ok).toBe(false)
    expect(across.error).toContain('partial-message_0.db')
  })

  it('reports a missing account instead of passing an empty list', () => {
    expect(verifyDbKeyAcross([], 'a'.repeat(64)).ok).toBe(false)
  })
})
