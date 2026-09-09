import { describe, expect, it } from 'vitest'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { DEFAULT_KEY_STEPS, keyStepsToProgress, maskSecret, mergeKeyStep, missingKeyKinds, secretRefFor, summarizeKeySteps, validateKeyHex } from './accountModel'

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
    expect(secretRefFor({ dbKeyRef: 'custom:ref' }, 'db_key')).toBe('custom:ref')
    expect(secretRefFor({}, 'image_aes')).toBe('account:imageAesKey')
  })
  it('masks without leaking length beyond 48 dots', () => {
    expect(maskSecret('db_key')).toHaveLength(48)
    expect(maskSecret('image_xor')).toBe('••')
  })
})

describe('key steps', () => {
  it('merges pushed steps by id and summarises progress', () => {
    let steps = [...DEFAULT_KEY_STEPS]
    steps = mergeKeyStep(steps, { id: 'db_key', label: '读取数据库密钥', status: 'done', detail: '0.2s' })
    steps = mergeKeyStep(steps, { id: 'image_xor', label: '提取图片 XOR 密钥', status: 'doing' })
    const s = summarizeKeySteps(steps)
    expect(s.done).toBe(1)
    expect(s.total).toBe(4)
    expect(s.running?.id).toBe('image_xor')
    expect(s.finished).toBe(false)
    expect(s.percent).toBe(25)
  })
  it('reports failures and the kinds that still need manual input', () => {
    const steps: KeyAcquireStep[] = DEFAULT_KEY_STEPS.map((s) => ({ ...s, status: s.id === 'image_aes' ? 'failed' : 'done' }))
    const s = summarizeKeySteps(steps)
    expect(s.finished).toBe(true)
    expect(s.failed.map((f) => f.id)).toEqual(['image_aes'])
    expect(missingKeyKinds(steps)).toEqual(['image_aes'])
    expect(keyStepsToProgress(steps)[3]).toMatchObject({ id: 'verify', status: 'done' })
  })
  it('appends unknown steps', () => {
    const merged = mergeKeyStep([], { id: 'verify', label: 'x', status: 'todo' })
    expect(merged).toHaveLength(1)
  })
})

it('accepts the original project’s case-sensitive AES string', () => {
  expect(validateKeyHex('image_aes', 'AbCdEfGh12345678')).toEqual({ ok: true, hex: '41624364456647683132333435363738' })
})
