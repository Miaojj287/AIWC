/**
 * Access to the desktop IPC bridge. Missing preload is an error, never a source of fabricated data.
 */
import type { AiwcBridge } from '@aiwc/protocol'
import { t } from '@/i18n'

declare global {
  interface Window {
    aiwc?: AiwcBridge
  }
}

let cached: AiwcBridge | undefined

export async function getBridge(): Promise<AiwcBridge> {
  if (cached) return cached
  if (window.aiwc) {
    cached = window.aiwc
    return cached
  }
  throw new Error(t('app.bridgeUnavailable'))
}

/** Synchronous accessor for code paths that run after bootstrap. */
export function bridge(): AiwcBridge {
  if (!cached) throw new Error('bridge not initialised — call getBridge() during bootstrap')
  return cached
}

/** Replace (or clear) the cached bridge — tests only. */
export function __setBridgeForTests(next: AiwcBridge | undefined): void {
  cached = next
  if (next) window.aiwc = next
  else delete window.aiwc
}
