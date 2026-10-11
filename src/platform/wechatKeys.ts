/**
 * Shared view of a WeChat key acquisition (substrate:acquireKeys + substrate:keyStep) for the two
 * places that run it — the onboarding keys card and Settings › 账号. Both render kit `TaskProgress`
 * from `keyAcquireView`, so the stage line, the countdown and the failure copy cannot drift apart.
 * Stage and failure copy come from stable codes (`phase` / `failure`), never from package text.
 */
import { useEffect, useState } from 'react'
import { finalizeKeySteps, keyAcquireStepIds, type KeyAcquireScope, type KeyAcquireStep } from '@aiwc/protocol'
import type { ProgressStep } from '@/kit'
import { t, type MessageKey } from '@/i18n'
import { formatDuration } from './format'

/** System Settings › Privacy & Security › Developer Tools — the grant a 'needs_authorization' failure asks for. */
export const DEVELOPER_TOOLS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_DevTools'

/** Tick rate of the elapsed / countdown clock while a run is visible. */
const CLOCK_TICK_MS = 1_000

const STEP_LABEL: Record<KeyAcquireStep['id'], MessageKey> = {
  db_key: 'app.keyAcquire.step.dbKey',
  image_xor: 'app.keyAcquire.step.imageXor',
  image_aes: 'app.keyAcquire.step.imageAes',
  verify: 'app.keyAcquire.step.verify',
}

/** Placeholder rows shown before the first push arrives (the first one is already running). */
export function initialKeySteps(scope: KeyAcquireScope = 'all'): KeyAcquireStep[] {
  return keyAcquireStepIds(scope).map((id, i) => ({ id, label: '', status: i === 0 ? 'doing' : 'todo' }))
}

/** Replace a step by id (or append) — used while `substrate:keyStep` pushes stream in. */
export function mergeKeyStep(steps: readonly KeyAcquireStep[], step: KeyAcquireStep): KeyAcquireStep[] {
  const idx = steps.findIndex((s) => s.id === step.id)
  if (idx < 0) return [...steps, step]
  return steps.map((s, i) => (i === idx ? { ...step } : s))
}

/** Close a run the renderer ended on its own (取消 / IPC error): nothing may stay ⟳ or ○. */
export function closeKeySteps(
  steps: readonly KeyAcquireStep[],
  reason: 'cancelled' | 'unexpected',
  detail?: string,
  scope: KeyAcquireScope = 'all',
): KeyAcquireStep[] {
  return finalizeKeySteps(steps, reason, () => '', scope).map((s) =>
    s.failure === reason && detail && !s.detail ? { ...s, detail } : s,
  )
}

/** One sentence the user can act on for a failed step: the coded reason, else the package's own text. */
export function keyStepFailureText(step: KeyAcquireStep): string {
  if (step.failure === 'unexpected') return t('app.keyAcquire.failure.unexpected', { detail: step.detail ?? '' })
  if (step.failure) return t(`app.keyAcquire.failure.${step.failure}`)
  return step.detail ?? t('app.keyAcquire.failure.not_found')
}

export interface KeyAcquireView {
  state: 'running' | 'failed' | 'done'
  title: string
  /** What the user should do now (only for stages that wait on them). */
  hint?: string
  /** Elapsed time while running. */
  meta?: string
  steps: ProgressStep[]
  /** The reason the run stopped, when it failed. */
  error?: string
  /** The failure is fixed in System Settings (offer a button that opens it). */
  needsSettings?: boolean
}

/**
 * Turn the live step list into what the panel shows. `running` is the caller's own flag (a run can
 * be in flight before any push arrives); `startedAt` / `now` drive the elapsed time and countdowns.
 */
export function keyAcquireView(
  steps: readonly KeyAcquireStep[],
  { running, startedAt, now }: { running: boolean; startedAt?: number; now: number },
): KeyAcquireView {
  const rows: ProgressStep[] = steps.map((s) => ({ id: s.id, label: t(STEP_LABEL[s.id]), status: s.status }))
  // The first real failure explains the run; 'skipped' rows only follow from it.
  const failed = steps.find((s) => s.status === 'failed' && s.failure !== 'skipped' && s.failure !== 'cancelled')
  if (!running) {
    if (failed) {
      return {
        state: 'failed',
        title: t('app.keyAcquire.failedTitle', { id: failed.id }),
        steps: rows,
        error: keyStepFailureText(failed),
        needsSettings: failed.failure === 'needs_authorization',
      }
    }
    return { state: 'done', title: t('app.keyAcquire.doneTitle'), steps: rows }
  }
  const active = steps.find((s) => s.status === 'doing')
  const phase = active?.phase
  const remaining = active?.waitUntil ? formatDuration(Math.max(0, active.waitUntil - now)) : undefined
  let hint: string | undefined
  if (phase === 'waiting_login') hint = t('app.keyAcquire.hint.waitingLogin', { time: remaining ?? '' })
  else if (phase === 'waiting_relaunch_login')
    hint = t('app.keyAcquire.hint.waitingRelaunchLogin', { time: remaining ?? '' })
  else if (phase === 'closing_wechat' || phase === 'launching_wechat') hint = t('app.keyAcquire.hint.reopening')
  return {
    state: 'running',
    title: phase ? t(`app.keyAcquire.phase.${phase}`) : t('app.keyAcquire.phase.starting'),
    hint,
    meta: startedAt ? formatDuration(now - startedAt) : undefined,
    steps: rows,
  }
}

/** Current time, re-rendered every second while `active` (for elapsed time and countdowns). */
export function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [active])
  return now
}
