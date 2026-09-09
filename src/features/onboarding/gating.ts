/**
 * Pure logic of the onboarding wizard (DESIGN-SPEC §5): the 下一步 gate and its disabled tooltip, key
 * hex validation, step-list merging for the key acquisition dialog, and the steps-bar state.
 */
import type { KeyAcquireStep } from '@aiwc/protocol'

export type KeyKind = KeyAcquireStep['id'] extends infer T ? Exclude<T, 'verify'> : never

export type KeyState =
  | { status: 'missing' }
  | { status: 'acquired'; source: 'auto' | 'cached' }
  | { status: 'manual'; hex: string }
  | { status: 'failed'; error: string; needsPermission?: boolean }

export type KeyStates = Record<KeyKind, KeyState>

export const KEY_KINDS: readonly KeyKind[] = ['db_key', 'image_xor', 'image_aes']

export const KEY_META: Record<KeyKind, { label: string; description: string; hexLength: number }> = {
  db_key: { label: '解密密钥', description: '64 位数据库解密密钥', hexLength: 64 },
  image_xor: { label: '图片 XOR 密钥', description: '用于还原微信图片资源', hexLength: 2 },
  image_aes: { label: '图片 AES 密钥', description: '用于解密图片资源索引', hexLength: 32 },
}

export const EMPTY_KEYS: KeyStates = { db_key: { status: 'missing' }, image_xor: { status: 'missing' }, image_aes: { status: 'missing' } }

export const hasKey = (k: KeyState): boolean => k.status === 'acquired' || k.status === 'manual'

export { validateWechatKey as validateKeyHex, normalizeWechatHex as normaliseHex } from '@aiwc/protocol'

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
  if (!input.dbRoot.trim()) missing.push('选择微信数据库目录')
  if (!input.wxid.trim()) missing.push('选择微信账号')
  else if (!input.verified) missing.push('验证账号')
  if (!input.dbKeyPresent) missing.push('获取解密密钥')
  if (missing.length === 0) return { ok: true, missing }
  return { ok: false, missing, reason: `请先${missing.join('并')}` }
}

/** Replace a step by id (or append) — used while `substrate:keyStep` events stream in. */
export function mergeKeyStep(steps: readonly KeyAcquireStep[], step: KeyAcquireStep): KeyAcquireStep[] {
  const idx = steps.findIndex((s) => s.id === step.id)
  if (idx < 0) return [...steps, step]
  return steps.map((s, i) => (i === idx ? { ...s, ...step } : s))
}

export const DEFAULT_KEY_STEPS: readonly KeyAcquireStep[] = [
  { id: 'db_key', label: '数据库解密密钥', status: 'todo' },
  { id: 'image_xor', label: '图片 XOR 密钥', status: 'todo' },
  { id: 'image_aes', label: '图片 AES 密钥', status: 'todo' },
  { id: 'verify', label: '验证账号与目录', status: 'todo' },
]

const PERMISSION_RE = /权限|permission|full disk|完全磁盘|eperm|eacces|operation not permitted/i

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
    else if (s.status === 'failed') next[s.id] = { status: 'failed', error: s.detail ?? '获取失败', needsPermission: permission && PERMISSION_RE.test(s.detail ?? '') }
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

export const STEP_LABELS = ['欢迎', '连接微信', '解锁数据', '完成'] as const

/**
 * Steps bar (Figma 91:417 bottom): 0 welcome → 1 connect (path + account) → 2 unlock (keys, once the
 * account is verified) → 3 done (while testing the connection).
 */
export function activeStepIndex(page: WizardPage, verified: boolean, testing: boolean): number {
  if (page === 'welcome') return 0
  if (testing) return 3
  return verified ? 2 : 1
}
