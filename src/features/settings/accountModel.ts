/**
 * Account page helpers (DESIGN-SPEC §2 账号): key hex validation, secret refs, and which keys a failed
 * acquisition still needs. Pure — tested in accountModel.test.ts. The progress view itself is shared
 * with onboarding in src/platform/wechatKeys.ts.
 */
import { validateWechatKey, type AppConfig, type KeyAcquireStep } from '@aiwc/protocol'
import { localizeKnownText, type MessageKey } from '@/i18n'

export type KeyKind = 'db_key' | 'image_xor' | 'image_aes'

/** Expected hex length per key: SQLCipher raw key 32 bytes, XOR one byte, AES 16 bytes. */
export const KEY_HEX_LENGTH: Record<KeyKind, number> = { db_key: 64, image_xor: 2, image_aes: 32 }

export const KEY_LABEL: Record<KeyKind, MessageKey> = {
  db_key: 'settings.account.keyLabel.dbKey',
  image_xor: 'settings.account.keyLabel.imageXor',
  image_aes: 'settings.account.keyLabel.imageAes',
}

export type HexValidation = { ok: true; hex: string } | { ok: false; error: string }

/** Protocol's key parser with its (package-side, Chinese) error mapped to the UI language. */
export function validateKeyHex(...args: Parameters<typeof validateWechatKey>): HexValidation {
  const v = validateWechatKey(...args)
  return v.ok ? v : { ...v, error: localizeKnownText(v.error) }
}

const DEFAULT_REF: Record<KeyKind, string> = {
  db_key: 'account:dbKey',
  image_xor: 'account:imageXorKey',
  image_aes: 'account:imageAesKey',
}

/** Secret-store reference for a key: the configured `*Ref`, else the conventional default. */
export function secretRefFor(account: AppConfig['account'] | undefined, kind: KeyKind): string {
  if (!account) return DEFAULT_REF[kind]
  const ref =
    kind === 'db_key' ? account.dbKeyRef : kind === 'image_xor' ? account.imageXorKeyRef : account.imageAesKeyRef
  return ref ?? DEFAULT_REF[kind]
}

/** Dots shown in place of a hidden key; length hints at the key size without leaking it. */
export function maskSecret(kind: KeyKind): string {
  return '•'.repeat(Math.min(48, KEY_HEX_LENGTH[kind]))
}

/** Which key kinds a failed step list still needs — drives the "手动输入" fallback. */
export function missingKeyKinds(steps: readonly KeyAcquireStep[]): KeyKind[] {
  return steps
    .filter(
      (s): s is KeyAcquireStep & { id: KeyKind } =>
        s.status === 'failed' && s.id !== 'verify' && s.failure !== 'cancelled' && s.failure !== 'skipped',
    )
    .map((s) => s.id)
}
