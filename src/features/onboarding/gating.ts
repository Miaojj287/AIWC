/**
 * Pure logic of the onboarding wizard (DESIGN-SPEC §5): the 下一步 gate and its disabled tooltip, key
 * hex validation, step-list merging for the key acquisition dialog, and the steps-bar state.
 */
import { validateWechatKey, type KeyAcquireStep } from '@aiwc/protocol'
import { localizeKnownText, t, type MessageKey } from '@/i18n'

export type KeyKind = KeyAcquireStep['id'] extends infer T ? Exclude<T, 'verify'> : never

export type KeyState =
  | { status: 'missing' }
  | { status: 'acquired'; source: 'auto' | 'cached' }
  | { status: 'manual'; hex: string }
  | { status: 'failed'; error: string; needsPermission?: boolean }

export type KeyStates = Record<KeyKind, KeyState>

export const KEY_KINDS: readonly KeyKind[] = ['db_key', 'image_xor', 'image_aes']

/** `label` / `description` are catalog keys — resolve them with t() at render. */
export const KEY_META: Record<KeyKind, { label: MessageKey; description: MessageKey; hexLength: number }> = {
  db_key: {
    label: 'onboarding.keys.kinds.dbKey.label',
    description: 'onboarding.keys.kinds.dbKey.description',
    hexLength: 64,
  },
  image_xor: {
    label: 'onboarding.keys.kinds.imageXor.label',
    description: 'onboarding.keys.kinds.imageXor.description',
    hexLength: 2,
  },
  image_aes: {
    label: 'onboarding.keys.kinds.imageAes.label',
    description: 'onboarding.keys.kinds.imageAes.description',
    hexLength: 32,
  },
}

export const EMPTY_KEYS: KeyStates = {
  db_key: { status: 'missing' },
  image_xor: { status: 'missing' },
  image_aes: { status: 'missing' },
}

export const hasKey = (k: KeyState): boolean => k.status === 'acquired' || k.status === 'manual'

export { normalizeWechatHex as normaliseHex } from '@aiwc/protocol'

/** Protocol's key validation, with its error text (computed in the package) shown in the UI language. */
export function validateKeyHex(...args: Parameters<typeof validateWechatKey>): ReturnType<typeof validateWechatKey> {
  const v = validateWechatKey(...args)
  return v.ok ? v : { ...v, error: localizeKnownText(v.error) }
}

export interface GateInput {
  dbRoot: string
  wxid: string
  verified: boolean
  dbKeyPresent: boolean
}

export interface GateResult {
  ok: boolean
  missing: string[]
  /** Tooltip on the disabled button, e.g. 请先验证账号并获取解密密钥. */
  reason?: string
}

/** 下一步 is enabled only when the account is verified and the DB key is present (DESIGN-SPEC §5 门禁). */
export function nextStepGate(input: GateInput): GateResult {
  const missing: string[] = []
  if (!input.dbRoot.trim()) missing.push(t('onboarding.gate.selectDbRoot'))
  if (!input.wxid.trim()) missing.push(t('onboarding.gate.selectAccount'))
  else if (!input.verified) missing.push(t('onboarding.gate.verifyAccount'))
  if (!input.dbKeyPresent) missing.push(t('onboarding.gate.getDbKey'))
  if (missing.length === 0) return { ok: true, missing }
  const [a, b, c] = missing
  return { ok: false, missing, reason: t('onboarding.gate.reason', { n: missing.length, a, b, c }) }
}

/** Replace a step by id (or append) — used while `substrate:keyStep` events stream in. */
export function mergeKeyStep(steps: readonly KeyAcquireStep[], step: KeyAcquireStep): KeyAcquireStep[] {
  const idx = steps.findIndex((s) => s.id === step.id)
  if (idx < 0) return [...steps, step]
  return steps.map((s, i) => (i === idx ? { ...s, ...step } : s))
}

/** Placeholder rows until `substrate:keyStep` streams the real ones; an empty label renders KEY_STEP_LABELS[id]. */
export const DEFAULT_KEY_STEPS: readonly KeyAcquireStep[] = [
  { id: 'db_key', label: '', status: 'todo' },
  { id: 'image_xor', label: '', status: 'todo' },
  { id: 'image_aes', label: '', status: 'todo' },
  { id: 'verify', label: '', status: 'todo' },
]

export const KEY_STEP_LABELS: Record<KeyAcquireStep['id'], MessageKey> = {
  db_key: 'onboarding.keys.steps.dbKey',
  image_xor: 'onboarding.keys.steps.imageXor',
  image_aes: 'onboarding.keys.steps.imageAes',
  verify: 'onboarding.keys.steps.verify',
}

// Matches failure details from the OS / main process (either UI language) — detection, not UI copy.
const PERMISSION_RE = /权限|permission|full disk|完全磁盘|eperm|eacces|operation not permitted|administrator rights/i

/** Does a failed step point at a missing system permission (→ guidance dialog)? */
export function needsPermission(steps: readonly KeyAcquireStep[]): boolean {
  return steps.some((s) => s.status === 'failed' && PERMISSION_RE.test(s.detail ?? ''))
}

/** Fold the final step list into per-key states; untouched keys keep their previous state. */
export function applyKeySteps(prev: KeyStates, steps: readonly KeyAcquireStep[]): KeyStates {
  const next: KeyStates = { ...prev }
  const permission = needsPermission(steps)
  for (const s of steps) {
    if (s.id === 'verify') continue
    if (s.status === 'done') next[s.id] = { status: 'acquired', source: 'auto' }
    else if (s.status === 'failed')
      next[s.id] = {
        status: 'failed',
        error: s.detail ?? t('onboarding.keys.acquireFailed'),
        needsPermission: permission && PERMISSION_RE.test(s.detail ?? ''),
      }
  }
  return next
}

export interface AcquireSummary {
  done: number
  total: number
  failed: KeyKind[]
  /** All three keys present (from this run or earlier). */
  complete: boolean
}

export function summariseKeys(keys: KeyStates): AcquireSummary {
  const failed = KEY_KINDS.filter((k) => keys[k].status === 'failed')
  const done = KEY_KINDS.filter((k) => hasKey(keys[k])).length
  return { done, total: KEY_KINDS.length, failed, complete: done === KEY_KINDS.length }
}

export type WizardPage = 'welcome' | 'connect'

export const STEP_LABELS: readonly MessageKey[] = [
  'onboarding.steps.welcome',
  'onboarding.steps.connect',
  'onboarding.steps.unlock',
  'onboarding.steps.done',
]

/**
 * Steps bar (Figma 91:417 bottom): 0 welcome → 1 connect (path + account) → 2 unlock (keys, once the
 * account is verified) → 3 done (while testing the connection).
 */
export function activeStepIndex(page: WizardPage, verified: boolean, testing: boolean): number {
  if (page === 'welcome') return 0
  if (testing) return 3
  return verified ? 2 : 1
}
