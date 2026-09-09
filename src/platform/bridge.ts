/**
 * Access to the desktop IPC bridge. Missing preload is an error, never a source of fabricated data.
 */
import type { AiwcBridge } from '@aiwc/protocol'

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
  throw new Error('无法连接本地微信数据服务，请在桌面应用中打开或重启应用。')
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
