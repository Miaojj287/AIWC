import { describe, expect, it } from 'vitest'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { EMPTY_KEYS, activeStepIndex, applyKeySteps, mergeKeyStep, needsPermission, nextStepGate, normaliseHex, summariseKeys, validateKeyHex } from './gating'

describe('validateKeyHex', () => {
  it('accepts 64 hex for the db key, with 0x and whitespace tolerated', () => {
    const hex = 'a'.repeat(64)
    expect(validateKeyHex('db_key', `0x${hex.toUpperCase()} `)).toEqual({ ok: true, hex })
    expect(normaliseHex(' 0xAB cd ')).toBe('abcd')
  })
  it('reports the Figma error copy for wrong lengths and characters', () => {
    expect(validateKeyHex('db_key', 'a'.repeat(42))).toEqual({ ok: false, error: '密钥应为 64 位十六进制字符，当前 42 位' })
    expect(validateKeyHex('image_aes', 'zz')).toEqual({ ok: false, error: 'AES 密钥应为 16 个字符或 32 位十六进制' })
    expect(validateKeyHex('image_xor', '')).toEqual({ ok: false, error: '请输入密钥' })
    expect(validateKeyHex('image_xor', '0x53')).toEqual({ ok: true, hex: '53' })
    expect(validateKeyHex('image_aes', 'f'.repeat(32))).toEqual({ ok: true, hex: 'f'.repeat(32) })
  })
})

describe('nextStepGate', () => {
  it('lists everything that is missing, in order', () => {
    expect(nextStepGate({ dbRoot: '', wxid: '', verified: false, dbKeyPresent: false })).toEqual({
      ok: false,
      missing: ['选择微信数据库目录', '选择微信账号', '获取解密密钥'],
      reason: '请先选择微信数据库目录并选择微信账号并获取解密密钥',
    })
  })
  it('asks to verify a chosen but unverified account', () => {
    expect(nextStepGate({ dbRoot: '/x', wxid: 'wxid_a', verified: false, dbKeyPresent: false }).reason).toBe('请先验证账号并获取解密密钥')
    expect(nextStepGate({ dbRoot: '/x', wxid: 'wxid_a', verified: true, dbKeyPresent: false }).reason).toBe('请先获取解密密钥')
  })
  it('passes when verified and the db key is present', () => {
    expect(nextStepGate({ dbRoot: '/x', wxid: 'wxid_a', verified: true, dbKeyPresent: true })).toEqual({ ok: true, missing: [] })
  })
})

describe('key steps', () => {
  const steps: KeyAcquireStep[] = [
    { id: 'db_key', label: 'db', status: 'done' },
    { id: 'image_xor', label: 'xor', status: 'done' },
    { id: 'image_aes', label: 'aes', status: 'failed', detail: 'kvcomm 中未找到，需回退到内存扫描' },
    { id: 'verify', label: 'verify', status: 'done' },
  ]
  it('merges step transitions by id', () => {
    const merged = mergeKeyStep(steps, { id: 'image_aes', label: 'aes', status: 'doing' })
    expect(merged[2]).toMatchObject({ id: 'image_aes', status: 'doing' })
    expect(merged).toHaveLength(4)
    expect(mergeKeyStep([], steps[0]!)).toHaveLength(1)
  })
  it('folds steps into key states and summarises partial success', () => {
    const keys = applyKeySteps(EMPTY_KEYS, steps)
    expect(keys.db_key).toEqual({ status: 'acquired', source: 'auto' })
    expect(keys.image_aes).toMatchObject({ status: 'failed', needsPermission: false })
    expect(summariseKeys(keys)).toEqual({ done: 2, total: 3, failed: ['image_aes'], complete: false })
  })
  it('keeps manual keys and detects permission failures', () => {
    const prev = { ...EMPTY_KEYS, image_aes: { status: 'manual' as const, hex: 'f'.repeat(32) } }
    const denied: KeyAcquireStep[] = [{ id: 'db_key', label: 'db', status: 'failed', detail: '需要「完全磁盘访问」权限' }]
    expect(needsPermission(denied)).toBe(true)
    const keys = applyKeySteps(prev, denied)
    expect(keys.image_aes.status).toBe('manual')
    expect(keys.db_key).toMatchObject({ status: 'failed', needsPermission: true })
  })
})

describe('activeStepIndex', () => {
  it('follows welcome → connect → unlock → done', () => {
    expect(activeStepIndex('welcome', false, false)).toBe(0)
    expect(activeStepIndex('connect', false, false)).toBe(1)
    expect(activeStepIndex('connect', true, false)).toBe(2)
    expect(activeStepIndex('connect', true, true)).toBe(3)
  })
})

it('accepts the original project’s case-sensitive AES string', () => {
  expect(validateKeyHex('image_aes', 'AbCdEfGh12345678')).toEqual({ ok: true, hex: '41624364456647683132333435363738' })
})
