import { describe, expect, it } from 'vitest'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { maskSecret, missingKeyKinds, secretRefFor, validateKeyHex } from './accountModel'

describe('validateKeyHex', () => {
  const key64 = 'a'.repeat(64)
  it('accepts a 64-hex db key, normalising case, whitespace and 0x', () => {
    expect(validateKeyHex('db_key', ` 0x${key64.toUpperCase()} `)).toEqual({ ok: true, hex: key64 })
  })
  it('rejects wrong length / characters / empty', () => {
    expect(validateKeyHex('db_key', 'abc')).toEqual({ ok: false, error: '密钥应为 64 位十六进制字符，当前 3 位' })
    expect(validateKeyHex('db_key', 'g'.repeat(64)).ok).toBe(false)
    expect(validateKeyHex('image_xor', '')).toEqual({ ok: false, error: '请输入密钥' })
  })
  it('uses the per-kind length', () => {
    expect(validateKeyHex('image_xor', '53')).toEqual({ ok: true, hex: '53' })
    expect(validateKeyHex('image_aes', 'f'.repeat(32)).ok).toBe(true)
    expect(validateKeyHex('image_aes', 'f'.repeat(64)).ok).toBe(false)
  })
})

describe('secret refs & masks', () => {
  it('prefers the configured ref and falls back to the conventional one', () => {
    expect(secretRefFor(undefined, 'db_key')).toBe('account:dbKey')
    expect(secretRefFor({ credentialRevision: 0, dbKeyRef: 'custom:ref' }, 'db_key')).toBe('custom:ref')
    expect(secretRefFor({ credentialRevision: 0 }, 'image_aes')).toBe('account:imageAesKey')
  })
  it('masks without leaking length beyond 48 dots', () => {
    expect(maskSecret('db_key')).toHaveLength(48)
    expect(maskSecret('image_xor')).toBe('••')
  })
})

describe('key steps', () => {
  it('lists the kinds that still need manual input, not ones a cancel or earlier failure left unrun', () => {
    const steps: KeyAcquireStep[] = [
      { id: 'db_key', label: '', status: 'done' },
      { id: 'image_xor', label: '', status: 'failed', failure: 'skipped' },
      { id: 'image_aes', label: '', status: 'failed', detail: 'no key' },
      { id: 'verify', label: '', status: 'failed' },
    ]
    expect(missingKeyKinds(steps)).toEqual(['image_aes'])
  })
})

it('accepts the original project’s case-sensitive AES string', () => {
  expect(validateKeyHex('image_aes', 'AbCdEfGh12345678')).toEqual({ ok: true, hex: '41624364456647683132333435363738' })
})
