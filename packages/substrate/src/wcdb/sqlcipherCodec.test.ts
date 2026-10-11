import { describe, expect, it } from 'vitest'
import { SQLCIPHER_PAGE_SIZE, deriveSqlcipherKey } from '../key/sqlcipherPage'
import { decryptPageInto, PAGE_BODY_END, resolvePageCipher, SQLITE_MAGIC } from './sqlcipherCodec'
import {
  encryptPage,
  expectedPlainPage,
  fixtureCipher,
  fixtureIv,
  FIXTURE_SALT,
  plaintextPage,
  splicePageIv,
  tamperPage,
} from './testing/sqlcipherFixture'

const KEY = Buffer.alloc(32, 7)
const KEY_HEX = KEY.toString('hex')
const CIPHER = fixtureCipher(KEY)

describe('resolvePageCipher', () => {
  it('uses an already derived key as is', () => {
    const page = encryptPage(plaintextPage(1, 0x5a), KEY, 1, fixtureIv(1))
    const cipher = resolvePageCipher(page, KEY_HEX)
    expect(cipher?.form).toBe('direct')
    expect(cipher?.key.equals(KEY)).toBe(true)
    expect(cipher?.saltHex).toBe(FIXTURE_SALT.toString('hex'))
  })

  it('runs PBKDF2 on a passphrase-shaped key', () => {
    const raw = Buffer.alloc(32, 3)
    const derived = deriveSqlcipherKey(raw, FIXTURE_SALT)
    const page = encryptPage(plaintextPage(1, 0x11), derived, 1, fixtureIv(2))
    const cipher = resolvePageCipher(page, raw.toString('hex'))
    expect(cipher?.form).toBe('raw')
    expect(cipher?.key.equals(derived)).toBe(true)
  })

  it('reports a plaintext database and rejects a key that does not match', () => {
    const plain = plaintextPage(1, 0)
    expect(resolvePageCipher(plain, KEY_HEX)?.form).toBe('plaintext')
    const page = encryptPage(plaintextPage(1, 0x5a), KEY, 1, fixtureIv(1))
    expect(resolvePageCipher(page, Buffer.alloc(32, 8).toString('hex'))).toBeNull()
  })
})

describe('decryptPageInto', () => {
  it('restores page 1 byte for byte and marks it as a rollback-journal database', () => {
    const plain = plaintextPage(1, 0x3c)
    const encrypted = encryptPage(plain, KEY, 1, fixtureIv(9))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    expect(decryptPageInto(encrypted, CIPHER, 1, out, 0)).toBe(true)
    expect(out.equals(expectedPlainPage(plain, 1, encrypted))).toBe(true)
    expect(out.subarray(0, 16).equals(SQLITE_MAGIC)).toBe(true)
    expect([out[18], out[19]]).toEqual([1, 1])
    // The reserved tail travels with the page: refreshes use its IV to spot rewritten pages.
    expect(out.subarray(PAGE_BODY_END).equals(encrypted.subarray(PAGE_BODY_END))).toBe(true)
  })

  it('decrypts a later page into an offset inside a batch buffer', () => {
    const plain = plaintextPage(4, 0x77)
    const encrypted = encryptPage(plain, KEY, 4, fixtureIv(4))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE * 2, 0xee)
    expect(decryptPageInto(encrypted, CIPHER, 4, out, SQLCIPHER_PAGE_SIZE)).toBe(true)
    expect(out.subarray(SQLCIPHER_PAGE_SIZE).equals(expectedPlainPage(plain, 4, encrypted))).toBe(true)
    expect(out.subarray(0, SQLCIPHER_PAGE_SIZE).every((b) => b === 0xee)).toBe(true)
  })

  it('refuses short pages, wrong key sizes and targets that cannot hold the page', () => {
    const encrypted = encryptPage(plaintextPage(2, 1), KEY, 2, fixtureIv(1))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    expect(decryptPageInto(encrypted.subarray(0, 100), CIPHER, 2, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, { key: Buffer.alloc(16), hmacKey: null }, 2, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, CIPHER, 0, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, CIPHER, 2, out, 8)).toBe(false)
  })

  it('refuses a page whose bytes changed after SQLCipher wrote it', () => {
    // AES-CBC without padding accepts anything, so only the HMAC separates a torn read from a page.
    const encrypted = encryptPage(plaintextPage(3, 0x2b), KEY, 3, fixtureIv(5))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    expect(decryptPageInto(tamperPage(encrypted, 16), CIPHER, 3, out, 0)).toBe(false)
    expect(out.every((byte) => byte === 0)).toBe(true)
    expect(decryptPageInto(encrypted, CIPHER, 3, out, 0)).toBe(true)
  })

  it('refuses an old page body carrying a newer IV, and the same page under another number', () => {
    const encrypted = encryptPage(plaintextPage(3, 0x2b), KEY, 3, fixtureIv(5))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    expect(decryptPageInto(splicePageIv(encrypted, fixtureIv(6)), CIPHER, 3, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, CIPHER, 4, out, 0)).toBe(false)
  })

  it('still decrypts when the database does not authenticate its pages', () => {
    const encrypted = encryptPage(plaintextPage(2, 0x41), KEY, 2, fixtureIv(7))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    expect(decryptPageInto(tamperPage(encrypted, 16), { key: KEY, hmacKey: null }, 2, out, 0)).toBe(true)
  })
})
