/**
 * The keys WeChat currently has configured in its own process, for databases the stored account key
 * cannot open. Read-only and platform-aware: on macOS one passphrase covers the whole account, so
 * there is nothing to collect and nothing to scan.
 */
import { findWeChatPidSync } from '../discovery/processDetect'
import { collectWindowsConfigCipherKeys } from './windowsMemoryScanner'

const COLLECT_BUDGET_MS = 15_000

export function collectWeChatDbKeyCandidates(): string[] {
  if (process.platform !== 'win32') return []
  const pid = findWeChatPidSync()
  if (!pid) return []
  return collectWindowsConfigCipherKeys(pid, Date.now() + COLLECT_BUDGET_MS)
}
