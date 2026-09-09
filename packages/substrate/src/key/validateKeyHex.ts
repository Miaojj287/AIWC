import { normalizeWechatHex, validateWechatKey, type WechatKeyKind } from '@aiwc/protocol'
export interface KeyHexValidation { ok: boolean; error?: string; normalized?: string }
export const normalizeKeyHex = normalizeWechatHex
const parse = (kind: WechatKeyKind, input: string): KeyHexValidation => {
  const result = validateWechatKey(kind, input)
  return result.ok ? { ok: true, normalized: result.hex } : result
}
export const validateKeyHexDetailed = (input: string): KeyHexValidation => parse('db_key', input)
export const validateXorKeyHex = (input: string): KeyHexValidation => parse('image_xor', input)
export const validateAesKeyHex = (input: string): KeyHexValidation => parse('image_aes', input)
export function validateKeyHex(input: string): { ok: boolean; error?: string } {
  const result = validateKeyHexDetailed(input)
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}
