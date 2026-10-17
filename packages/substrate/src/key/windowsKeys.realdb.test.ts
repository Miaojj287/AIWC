/** Explicitly opt in with AIWC_TEST_WINDOWS_CREDENTIALS=1 and account/root environment inputs. */
import { realpathSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findWeChatPidSync } from '../discovery/processDetect'
import { resolveDbStoragePath } from '../wcdb/dbFiles'
import { credentialDatabaseFiles } from './credentialFiles'
import { scanWindowsCredentials } from './windowsCredentialScanner'

const ROOT = process.env.AIWC_TEST_ROOT ?? ''
const ACCOUNT_ID = process.env.AIWC_TEST_WXID ?? ''
const SCAN_TIMEOUT_MS = 60_000
const TEST_TIMEOUT_MS = 90_000
const canRun =
  process.platform === 'win32' && process.env.AIWC_TEST_WINDOWS_CREDENTIALS === '1' && Boolean(ROOT && ACCOUNT_ID)

describe.skipIf(!canRun)('Windows authenticated credential coverage', () => {
  it(
    'matches the actual inventory from a single process candidate pool',
    async () => {
      let total = 0
      let matched = 0
      const startedAt = Date.now()
      try {
        const pid = findWeChatPidSync()
        const discovered = resolveDbStoragePath(ROOT, ACCOUNT_ID)
        if (!pid || !discovered) throw new Error('WINDOWS_CREDENTIAL_TEST_UNAVAILABLE')
        const storage = realpathSync(discovered)
        const targets = credentialDatabaseFiles(storage)
        total = targets.length
        const result = await scanWindowsCredentials({
          pid,
          accountId: ACCOUNT_ID,
          dbStoragePath: storage,
          targets,
          timeoutMs: SCAN_TIMEOUT_MS,
        })
        matched = result.bundle?.entries.length ?? 0
      } catch {
        // File and native errors can contain private account paths; do not render their messages.
        throw new Error('WINDOWS_CREDENTIAL_TEST_FAILED')
      }
      console.log(JSON.stringify({ total, matched, elapsedMs: Date.now() - startedAt }))
      expect(total).toBeGreaterThan(0)
      expect(matched).toBeGreaterThan(0)
      expect(matched).toBeLessThanOrEqual(total)
    },
    TEST_TIMEOUT_MS,
  )
})
