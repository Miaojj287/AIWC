import { describe, expect, it } from 'vitest'
import {
  DEFAULT_V1_AES_KEY,
  asciiKey16,
  decryptDatBuffer,
  decryptDatV3,
  decryptDatV4,
  detectImageExtension,
  encryptDatV4,
  getDatVersion,
  guessXorKey,
  isWxgf,
  normalizeAesKey,
  normalizeXorKey,
  stripTrailingNulBytes,
} from './datDecryptCore'

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

function fakeJpeg(size: number): Buffer {
  const body = Buffer.alloc(size, 0x41)
  JPEG_HEADER.copy(body, 0)
  body[size - 2] = 0xff
  body[size - 1] = 0xd9
  return body
}

describe('detectImageExtension', () => {
  it('recognises jpg/png/wxgf', () => {
    expect(detectImageExtension(JPEG_HEADER)).toBe('.jpg')
    expect(detectImageExtension(PNG_HEADER)).toBe('.png')
    expect(isWxgf(Buffer.from('wxgfXXXX'))).toBe(true)
  })
})

describe('normalizers', () => {
  it('parses xor keys', () => {
    expect(normalizeXorKey(0x73)).toBe(0x73)
    expect(normalizeXorKey('0x73')).toBe(0x73)
    expect(normalizeXorKey('115')).toBe(115)
    expect(normalizeXorKey('ab')).toBe(0xab)
  })
  it('parses aes keys (ascii + hex)', () => {
    expect(normalizeAesKey('0123456789abcdef').length).toBe(16)
    expect(normalizeAesKey('ab'.repeat(16)).equals(Buffer.from('ab'.repeat(16), 'hex'))).toBe(true)
    expect(asciiKey16(DEFAULT_V1_AES_KEY).length).toBe(16)
  })
})

describe('V3 (xor) decrypt', () => {
  it('passes plaintext dats through, trimming NULs', () => {
    const plain = Buffer.concat([fakeJpeg(300), Buffer.alloc(5, 0)])
    const out = decryptDatV3(plain, 0x73)
    expect(out.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)
    expect(out[out.length - 1]).toBe(0xd9)
  })
  it('xor-decrypts an encrypted dat and can guess the key', () => {
    const plain = fakeJpeg(300)
    const xorKey = 0x37
    const encrypted = Buffer.alloc(plain.length)
    for (let i = 0; i < plain.length; i++) encrypted[i] = plain[i]! ^ xorKey
    expect(guessXorKey(encrypted)).toBe(xorKey)
    expect(decryptDatV3(encrypted, null).equals(plain)).toBe(true)
  })
})

describe('V4 (aes + xor) round trip', () => {
  it('encrypts then decrypts to the original', () => {
    const plain = fakeJpeg(3000)
    const aesKey = Buffer.from('0123456789abcdef', 'ascii')
    const xorKey = 0x5a
    const dat = encryptDatV4(plain, xorKey, aesKey)
    expect(getDatVersion(dat)).toBe(2)
    const out = decryptDatV4(dat, xorKey, aesKey)
    expect(out.equals(plain)).toBe(true)
  })
  it('decryptDatBuffer dispatches by header', () => {
    const plain = fakeJpeg(2500)
    const aesKey = Buffer.from('fedcba9876543210', 'ascii')
    const dat = encryptDatV4(plain, 0x11, aesKey)
    const result = decryptDatBuffer(dat, { xorKey: 0x11, aesKey })
    expect(result.version).toBe(2)
    expect(result.ext).toBe('.jpg')
    expect(result.data.equals(plain)).toBe(true)
  })
  it('rejects a wrong AES key via padding check', () => {
    const dat = encryptDatV4(fakeJpeg(2000), 0x11, Buffer.from('0123456789abcdef', 'ascii'))
    expect(() => decryptDatV4(dat, 0x11, Buffer.from('WRONGKEYWRONGKEY', 'ascii'))).toThrow()
  })
})

describe('stripTrailingNulBytes', () => {
  it('trims only trailing zeros', () => {
    expect(stripTrailingNulBytes(Buffer.from([1, 2, 0, 0])).equals(Buffer.from([1, 2]))).toBe(true)
    expect(stripTrailingNulBytes(Buffer.from([1, 2])).equals(Buffer.from([1, 2]))).toBe(true)
  })
})
