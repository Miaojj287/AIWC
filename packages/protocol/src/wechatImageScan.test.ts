import { describe, expect, it } from 'vitest'
import { WechatImageScanResultSchema } from './wechatImageScan'

describe('private image scan contract', () => {
  it('accepts success, denied access, and an exhausted scan', () => {
    expect(
      WechatImageScanResultSchema.safeParse({ success: true, attached: true, aesKeyHex: 'a'.repeat(32), bytes: 10 })
        .success,
    ).toBe(true)
    expect(WechatImageScanResultSchema.safeParse({ success: false, attached: false, attachCode: 5 }).success).toBe(true)
    expect(WechatImageScanResultSchema.safeParse({ success: false, attached: true }).success).toBe(true)
  })
  it.each([
    {},
    { success: true, attached: true },
    { success: true, attached: false, aesKeyHex: 'a'.repeat(32) },
    { success: true, attached: true, aesKeyHex: 'not-a-key' },
    { success: false, attached: true, aesKeyHex: 'a'.repeat(32) },
    { success: false, attached: false, attachCode: 1.5 },
  ])('rejects inconsistent or malformed output %#', (value) => {
    expect(WechatImageScanResultSchema.safeParse(value).success).toBe(false)
  })
})
