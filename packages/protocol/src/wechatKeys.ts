/** Shared, browser-safe parsing for manually pasted WeChat keys. Never include key material in errors. */
export type WechatKeyKind = 'db_key' | 'image_xor' | 'image_aes'
export type WechatKeyValidation = { ok: true; hex: string } | { ok: false; error: string }

export function normalizeWechatHex(input: string): string {
  return String(input ?? '').trim().replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase()
}

export function validateWechatKey(kind: WechatKeyKind, input: string): WechatKeyValidation {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: '请输入密钥' }
  // AIWC_ORG exports AES as a case-sensitive, 16-character ASCII string.
  // Decode that representation before hex normalization can change its bytes.
  if (kind === 'image_aes' && /^[\x20-\x7e]{16}$/.test(raw)) {
    return { ok: true, hex: Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') }
  }
  const length = { db_key: 64, image_xor: 2, image_aes: 32 }[kind]
  if (!length) return { ok: false, error: '不支持的密钥类型' }
  const hex = normalizeWechatHex(raw)
  if (kind === 'image_aes' && !/^[0-9a-f]{32}$/.test(hex)) return { ok: false, error: 'AES 密钥应为 16 个字符或 32 位十六进制' }
  if (!/^[0-9a-f]+$/.test(hex)) return { ok: false, error: '密钥只能包含 0-9 和 a-f' }
  if (hex.length !== length) return { ok: false, error: `密钥应为 ${length} 位十六进制字符，当前 ${hex.length} 位` }
  return { ok: true, hex }
}
