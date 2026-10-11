/**
 * Key acquisition progress contract (substrate:acquireKeys / substrate:keyStep). `phase` and `failure`
 * are stable codes the UI renders in its own language; `detail` is a free-form note (package text,
 * localized at the main-process boundary) kept for diagnostics.
 */

/** What the acquisition is doing right now — one per user-visible stage. */
export const KEY_ACQUIRE_PHASES = [
  /** Read-only scan of the running WeChat process. */
  'reading_memory',
  /** Read-only scan of WeChat's own crash dumps (files only, no privilege). */
  'reading_dumps',
  /** Attaching the login hook to the running WeChat process. */
  'arming_hook',
  /** Hook armed — the user has to log out of WeChat and log back in (`waitUntil` is the deadline). */
  'waiting_login',
  /** Quitting WeChat so it can be started fresh. */
  'closing_wechat',
  /** Starting WeChat again. */
  'launching_wechat',
  /** WeChat restarted — waiting for it to log in so the key can be read (`waitUntil` is the deadline). */
  'waiting_relaunch_login',
  /** Deriving the image XOR key from template files. */
  'deriving_image_key',
  /** Scanning process memory for the image AES key. */
  'scanning_image_key',
  /** Checking the key against the account databases. */
  'verifying',
] as const
export type KeyAcquirePhase = (typeof KEY_ACQUIRE_PHASES)[number]

/** Why a step ended in `failed`, when the reason is one the UI explains with its own copy. */
export const KEY_ACQUIRE_FAILURES = [
  /** The user cancelled the run. */
  'cancelled',
  /** An earlier step failed, so this one never ran. */
  'skipped',
  /** The login hook was armed but nobody logged in before the deadline. */
  'login_timeout',
  /** WeChat quit while the login hook was waiting (the user quit the app instead of logging out). */
  'wechat_exited',
  /** WeChat was quit for a fresh start but did not come back. */
  'wechat_relaunch_failed',
  /** WeChat restarted but the key was not found before the deadline. */
  'relaunch_timeout',
  /** macOS SIP blocks the login hook and the read-only paths found nothing. */
  'sip_enabled',
  /** The OS denied access to WeChat's process (Developer Tools / SIP). */
  'needs_authorization',
  /** WeChat is not running and could not be found. */
  'wechat_not_running',
  /** Every path ran but none found the key. */
  'not_found',
  /** Something threw; `detail` carries the message. */
  'unexpected',
] as const
export type KeyAcquireFailure = (typeof KEY_ACQUIRE_FAILURES)[number]

export interface KeyAcquireStep {
  id: 'db_key' | 'image_xor' | 'image_aes' | 'verify'
  label: string
  status: 'todo' | 'doing' | 'done' | 'failed'
  detail?: string
  /** Current stage while `doing`. */
  phase?: KeyAcquirePhase
  /** Epoch ms deadline of a stage that waits for the user (waiting_login / waiting_relaunch_login). */
  waitUntil?: number
  /** Stable reason when `failed`. */
  failure?: KeyAcquireFailure
}

/** Which keys a run acquires: everything, or only the image keys. */
export type KeyAcquireScope = 'all' | 'image'

/** The steps a run reports, in display order. */
const KEY_ACQUIRE_STEP_IDS: readonly KeyAcquireStep['id'][] = ['db_key', 'image_xor', 'image_aes', 'verify']
const IMAGE_STEP_IDS: readonly KeyAcquireStep['id'][] = ['image_xor', 'image_aes']

export function keyAcquireStepIds(scope: KeyAcquireScope = 'all'): readonly KeyAcquireStep['id'][] {
  return scope === 'image' ? IMAGE_STEP_IDS : KEY_ACQUIRE_STEP_IDS
}

/**
 * Close out a step list so every step ends terminal: steps still `doing` / `todo` become `failed` with
 * `failure` (e.g. 'cancelled'), missing ids are appended the same way. Pure; used by the package, the
 * main process and the renderer so a stopped run never leaves a spinner or an untouched ○ behind.
 */
export function finalizeKeySteps(
  steps: readonly KeyAcquireStep[],
  failure: KeyAcquireFailure,
  label: (id: KeyAcquireStep['id']) => string = () => '',
  scope: KeyAcquireScope = 'all',
): KeyAcquireStep[] {
  const ids = keyAcquireStepIds(scope)
  const byId = new Map(steps.map((s) => [s.id, s]))
  const ordered = [
    ...ids.map((id) => byId.get(id) ?? { id, label: label(id), status: 'todo' as const }),
    ...steps.filter((s) => !ids.includes(s.id)),
  ]
  return ordered.map((s) => {
    if (s.status === 'done' || s.status === 'failed') return s
    // Only the step that was running was actually interrupted; the rest never started.
    const reason: KeyAcquireFailure = s.status === 'doing' || failure === 'cancelled' ? failure : 'skipped'
    return { ...s, status: 'failed', failure: reason, phase: undefined, waitUntil: undefined }
  })
}
