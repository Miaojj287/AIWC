import { describe, expect, it } from 'vitest'
import { SQLCIPHER_PAGE_SIZE, deriveSqlcipherKey } from '../key/sqlcipherPage'
import { decryptPageInto, PAGE_BODY_END, resolvePageCipher, SQLITE_MAGIC } from './sqlcipherCodec'
import { encryptPage, expectedPlainPage, fixtureIv, FIXTURE_SALT, plaintextPage } from './testing/sqlcipherFixture'

const KEY = Buffer.alloc(32, 7)
const KEY_HEX = KEY.toString('hex')

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
    expect(decryptPageInto(encrypted, KEY, 1, out, 0)).toBe(true)
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
    expect(decryptPageInto(encrypted, KEY, 4, out, SQLCIPHER_PAGE_SIZE)).toBe(true)
    expect(out.subarray(SQLCIPHER_PAGE_SIZE).equals(expectedPlainPage(plain, 4, encrypted))).toBe(true)
    expect(out.subarray(0, SQLCIPHER_PAGE_SIZE).every((b) => b === 0xee)).toBe(true)
  })

  it('refuses short pages, wrong key sizes and targets that cannot hold the page', () => {
    const encrypted = encryptPage(plaintextPage(2, 1), KEY, 2, fixtureIv(1))
    const out = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    expect(decryptPageInto(encrypted.subarray(0, 100), KEY, 2, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, Buffer.alloc(16), 2, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, KEY, 0, out, 0)).toBe(false)
    expect(decryptPageInto(encrypted, KEY, 2, out, 8)).toBe(false)
  })
})
