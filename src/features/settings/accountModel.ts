/**
 * Account page helpers (DESIGN-SPEC §2 账号): key hex validation, secret refs, and the mapping of
 * substrate:acquireKeys steps onto the ProgressDialog. Pure — tested in accountModel.test.ts.
 */
import { validateWechatKey, type AppConfig, type KeyAcquireStep } from '@aiwc/protocol'
import type { ProgressStep } from '@/kit'
import { localizeKnownText, t, type MessageKey } from '@/i18n'

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

/** Placeholder steps until main pushes its own; labels are getters so a copy (`{ ...step }`) takes the current language. */
export const DEFAULT_KEY_STEPS: readonly KeyAcquireStep[] = [
  {
    id: 'db_key',
    get label() {
      return t('settings.account.steps.dbKey')
    },
    status: 'todo',
  },
  {
    id: 'image_xor',
    get label() {
      return t('settings.account.steps.imageXor')
    },
    status: 'todo',
  },
  {
    id: 'image_aes',
    get label() {
      return t('settings.account.steps.imageAes')
    },
    status: 'todo',
  },
  {
    id: 'verify',
    get label() {
      return t('settings.account.steps.verify')
    },
    status: 'todo',
  },
]

/** Replace the step with the same id (or append) — used for the substrate:keyStep push events. */
export function mergeKeyStep(steps: readonly KeyAcquireStep[], step: KeyAcquireStep): KeyAcquireStep[] {
  const idx = steps.findIndex((s) => s.id === step.id)
  if (idx < 0) return [...steps, step]
  return steps.map((s, i) => (i === idx ? { ...s, ...step } : s))
}

export interface KeyStepsSummary {
  done: number
  total: number
  percent: number
  failed: KeyAcquireStep[]
  running: KeyAcquireStep | undefined
  finished: boolean
}

export function summarizeKeySteps(steps: readonly KeyAcquireStep[]): KeyStepsSummary {
  const total = steps.length
  const done = steps.filter((s) => s.status === 'done').length
  const failed = steps.filter((s) => s.status === 'failed')
  const running = steps.find((s) => s.status === 'doing')
  const finished = total > 0 && steps.every((s) => s.status === 'done' || s.status === 'failed')
  return {
    done,
    total,
    percent: total ? Math.round(((done + failed.length) / total) * 100) : 0,
    failed,
    running,
    finished,
  }
}

export function keyStepsToProgress(steps: readonly KeyAcquireStep[]): ProgressStep[] {
  return steps.map((s) => ({ id: s.id, label: s.label, status: s.status, detail: s.detail }))
}

/** Which key kinds a failed step list still needs — drives the "手动输入" fallback. */
export function missingKeyKinds(steps: readonly KeyAcquireStep[]): KeyKind[] {
  return steps
    .filter((s): s is KeyAcquireStep & { id: KeyKind } => s.status === 'failed' && s.id !== 'verify')
    .map((s) => s.id)
}
