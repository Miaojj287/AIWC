/**
 * Windows-only real-machine diagnosis: is WeChat's database key account-wide, or does every database
 * get its own? The app stores one key per account, so the answer decides whether that model holds.
 *
 * Each database is scanned on its own (no cross-database filtering), then the keys are compared by
 * fingerprint — a SHA-256 prefix, so identical keys are recognisable without printing key material.
 * One distinct fingerprint means the key is account-wide; several mean WeChat configures WCDB per
 * database and a single stored key can never read everything.
 *
 * PowerShell (WeChat must be running and logged in as this account):
 *   $env:AIWC_TEST_ROOT = 'C:\Users\<you>\Documents\xwechat_files'
 *   $env:AIWC_TEST_WXID = 'wxid_…'
 *   npx vitest run packages/substrate/src/key/windowsKeys.realdb.test.ts
 */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findWeChatPidSync } from '../discovery/processDetect'
import { findMessageShards, findNamedDb, findSessionDbCandidates, resolveDbStoragePath } from '../wcdb/dbFiles'
import { classifyKeyAgainstPage, readEncryptedDbSalt, readFirstPage } from './sqlcipherPage'
import { scanWindowsDbKey } from './windowsMemoryScanner'

const ROOT = process.env.AIWC_TEST_ROOT || ''
const WXID = process.env.AIWC_TEST_WXID || ''
const PER_DATABASE_BUDGET_MS = 60_000
const run = process.platform === 'win32' && ROOT && WXID ? describe : describe.skip

/** Comparable without revealing the key. */
function fingerprint(keyHex: string): string {
  return createHash('sha256').update(keyHex).digest('hex').slice(0, 12)
}

run('Windows database key shape', () => {
  it('scans every database of the account separately and compares the keys', () => {
    const pid = findWeChatPidSync()
    expect(pid, 'WeChat (Weixin.exe) is not running').toBeTruthy()
    const storage = resolveDbStoragePath(ROOT, WXID)
    expect(storage, `no db_storage under ${ROOT} for ${WXID}`).toBeTruthy()

    const files = [
      ...findSessionDbCandidates(storage as string).slice(0, 1),
      findNamedDb(storage as string, 'contact.db'),
      ...findMessageShards(storage as string)
        .slice(0, 2)
        .map((shard) => shard.dbPath),
    ].filter((path): path is string => !!path)
    expect(files.length).toBeGreaterThan(1)

    const fingerprints = new Map<string, string>()
    for (const file of files) {
      const scan = scanWindowsDbKey(pid as number, file, Date.now() + PER_DATABASE_BUDGET_MS)
      const page = readFirstPage(file)
      const form = scan.key && page ? classifyKeyAgainstPage(page, scan.key) : null
      console.log(
        'DB',
        basename(file).padEnd(16),
        '| salt',
        readEncryptedDbSalt(file) ?? 'plaintext',
        '| key',
        scan.key ? fingerprint(scan.key) : 'NONE',
        '| form',
        form ?? '-',
        '| candidates',
        scan.candidates,
        '| bytes',
        scan.bytes,
      )
      if (scan.key) fingerprints.set(basename(file), fingerprint(scan.key))
    }

    const distinct = new Set(fingerprints.values())
    console.log(
      `RESULT ${fingerprints.size}/${files.length} databases yielded a key, ${distinct.size} distinct →`,
      distinct.size === 1 ? 'ACCOUNT-WIDE' : 'PER DATABASE',
    )
    // The scan has to find a key for the session database at the very least.
    expect(fingerprints.size).toBeGreaterThan(0)
  }, 300_000)
})
