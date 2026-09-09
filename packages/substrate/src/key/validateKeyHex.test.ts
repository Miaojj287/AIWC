import { describe, expect, it } from 'vitest'
import { normalizeKeyHex, validateAesKeyHex, validateKeyHex, validateKeyHexDetailed, validateXorKeyHex } from './validateKeyHex'

const KEY64 = 'a'.repeat(64)

describe('validateKeyHex', () => {
  it('accepts 64 hex chars, ignoring 0x and whitespace', () => {
    expect(validateKeyHex(KEY64).ok).toBe(true)
    expect(validateKeyHex(`0X${KEY64.toUpperCase()}`).ok).toBe(true)
    expect(validateKeyHexDetailed(` ${KEY64} `).normalized).toBe(KEY64)
  })
  it('rejects wrong length and non-hex', () => {
    expect(validateKeyHex('abc').ok).toBe(false)
    expect(validateKeyHex('z'.repeat(64)).ok).toBe(false)
    expect(validateKeyHex('').ok).toBe(false)
  })
  it('normalizeKeyHex lowercases and strips', () => {
    expect(normalizeKeyHex('0xABCD ')).toBe('abcd')
  })
})

describe('image key validation', () => {
  it('validates a 1-byte xor key', () => {
    expect(validateXorKeyHex('73').normalized).toBe('73')
    expect(validateXorKeyHex('7').ok).toBe(false)
  })
  it('accepts 16-char ascii or 32-hex aes key', () => {
    expect(validateAesKeyHex('0123456789abcdef').normalized).toBe(Buffer.from('0123456789abcdef', 'ascii').toString('hex'))
    expect(validateAesKeyHex('ab'.repeat(16)).normalized).toBe('ab'.repeat(16))
    expect(validateAesKeyHex('short').ok).toBe(false)
  })
})
