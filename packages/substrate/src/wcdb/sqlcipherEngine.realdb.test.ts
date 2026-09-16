/**
 * Real-machine diagnosis of the database key and the pure-TypeScript SQLCipher engine.
 *
 * It recovers the key from the running WeChat itself, so nothing secret has to be typed on a command
 * line, then reports **which key representation every database of the account accepts** before
 * reading the account through the engine. That middle step is the interesting one: a key is valid for
 * one SQLCipher file only if it either is that file's raw passphrase ('raw', PBKDF2 with the file's
 * own salt) or is a key SQLCipher can use as is ('direct'). If a key matched `session.db` but no
 * other file, WeChat would be handing out per-file keys and the single account-wide key this app
 * stores could never work — this test is what tells the two apart. Output is structural only: paths,
 * public header salts, forms and counts, never chat content.
 *
 * PowerShell:
 *   $env:AIWC_TEST_ROOT = 'C:\Users\<you>\Documents\xwechat_files'
 *   $env:AIWC_TEST_WXID = 'wxid_…'          # the account folder currently logged in
 *   npx vitest run packages/substrate/src/wcdb/sqlcipherEngine.realdb.test.ts
 *
 * Set `AIWC_TEST_NATIVE` to `resources/native/<platform>-<arch>` to run the native WCDB engine
 * instead (macOS), which is how the two engines get compared on the same data.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { acquireKeys } from '../key'
import { classifyKeyAgainstPage, readEncryptedDbSalt, readFirstPage } from '../key/sqlcipherPage'
import { findMessageShards, findNamedDb, findSessionDbCandidates, resolveDbStoragePath } from './dbFiles'
import { createWcdbSourceReader } from './wcdbSourceReader'

const ROOT = process.env.AIWC_TEST_ROOT || ''
const WXID = process.env.AIWC_TEST_WXID || ''
const NATIVE = process.env.AIWC_TEST_NATIVE || ''
const run = ROOT && WXID ? describe : describe.skip

let cacheDir = ''

afterAll(() => {
  // Decrypted copies are plaintext chat data: they must not outlive the test.
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true })
})

run('SQLCipher engine on real WeChat data', () => {
  it('opens every database of the account with the key scanned out of WeChat', async () => {
    const result = await acquireKeys({
      dbRoot: ROOT,
      wxid: WXID,
      strategy: 'auto',
      nativeDir: NATIVE,
      onStep: (step) => console.log('STEP', step.id, step.status, step.detail ?? ''),
    })
    expect(result.dbKeyHex, 'no db key recovered — is this account the one logged in?').toBeTruthy()
    const keyHex = result.dbKeyHex as string

    const storage = resolveDbStoragePath(ROOT, WXID)
    expect(storage, `no db_storage under ${ROOT} for ${WXID}`).toBeTruthy()
    const files = [
      findSessionDbCandidates(storage as string)[0],
      findNamedDb(storage as string, 'contact.db'),
      ...findMessageShards(storage as string)
        .slice(0, 3)
        .map((shard) => shard.dbPath),
    ].filter((path): path is string => !!path)
    expect(files.length).toBeGreaterThan(1)

    const forms = files.map((file) => {
      const page = readFirstPage(file)
      const form = page ? classifyKeyAgainstPage(page, keyHex) : null
      console.log(
        'DB',
        file.slice((storage as string).length),
        '| salt',
        readEncryptedDbSalt(file) ?? 'plaintext',
        '| key form',
        form ?? 'NO MATCH',
      )
      return { file, form }
    })
    const rejected = forms.filter((entry) => entry.form === null).map((entry) => entry.file)
    expect(rejected, 'these databases reject the account key').toEqual([])

    cacheDir = mkdtempSync(join(tmpdir(), 'aiwc-realdb-'))
    const reader = createWcdbSourceReader({
      nativeDir: NATIVE,
      logger: (level, message, meta) => console.log(level, message, meta ?? ''),
    })
    await reader.open({ dbRoot: ROOT, wxid: WXID, dbKeyHex: keyHex, cacheDir })
    try {
      const account = await reader.account()
      const sessions = await reader.sessions()
      const contacts = await reader.contacts()
      console.log('ACCOUNT verified:', account.verified, '| sessions:', sessions.length, '| contacts:', contacts.length)
      expect(sessions.length).toBeGreaterThan(0)

      const busiest = sessions.find((session) => !!session.lastMessageAt) ?? sessions[0]
      if (busiest) {
        const messages = await reader.messagesBefore(busiest.id, Number.MAX_SAFE_INTEGER, 20)
        console.log('MESSAGES read from the newest chat:', messages.length)
        expect(messages.length, 'sessions opened but no message shard could be read').toBeGreaterThan(0)
      }
    } finally {
      await reader.close()
    }
  }, 300_000)
})
