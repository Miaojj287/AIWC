import { describe, expect, it } from 'vitest'
import { createCipheriv } from 'node:crypto'
import { findWindowsImageAesKey, verifyWindowsImageAesKey } from './windowsMemoryScanner'

/** Encrypt a 16-byte plaintext (JPEG magic + filler) with an ASCII AES-128 key. */
function encryptBlock(keyAscii: string, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(keyAscii, 'ascii'), null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

const KEY = '0123456789abcdef' // 16 ASCII chars = the AES-128 key
const JPEG_BLOCK = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12, 0x11)])
const ciphertext = encryptBlock(KEY, JPEG_BLOCK)

describe('verifyWindowsImageAesKey', () => {
  it('accepts the correct key and rejects a wrong one', () => {
    expect(verifyWindowsImageAesKey(Buffer.from(KEY, 'ascii'), ciphertext)).toBe(true)
    expect(verifyWindowsImageAesKey(Buffer.from('ffffffffffffffff', 'ascii'), ciphertext)).toBe(false)
  })
})

describe('findWindowsImageAesKey', () => {
  it('finds the key inside a 32-char alphanumeric token (first 16 chars are the key)', () => {
    const token = Buffer.from(`${KEY}ghijklmnopqrstuv`, 'ascii') // 32 alnum chars
    const data = Buffer.concat([Buffer.from([0x00, 0x01, 0x7f]), token, Buffer.from([0x00, 0x00])])
    const found = findWindowsImageAesKey(data, ciphertext)
    expect(found.key).toBe(KEY)
  })

  it('finds a bare printable 16-byte key delimited by non-printable bytes', () => {
    const data = Buffer.concat([Buffer.from([0x00, 0x00]), Buffer.from(KEY, 'ascii'), Buffer.from([0x00, 0x00])])
    const found = findWindowsImageAesKey(data, ciphertext)
    expect(found.key).toBe(KEY)
  })

  it('finds the key stored as UTF-16LE', () => {
    const token = `${KEY}ghijklmnopqrstuv`
    const utf16 = Buffer.alloc(token.length * 2)
    for (let i = 0; i < token.length; i += 1) utf16[i * 2] = token.charCodeAt(i)
    const data = Buffer.concat([Buffer.from([0x03]), utf16, Buffer.from([0x03])])
    const found = findWindowsImageAesKey(data, ciphertext)
    expect(found.key).toBe(KEY)
  })

  it('returns null when no candidate decrypts to an image header', () => {
    const data = Buffer.from('the quick brown fox jumps over the lazy dog once', 'ascii')
    expect(findWindowsImageAesKey(data, ciphertext).key).toBeNull()
  })
})
