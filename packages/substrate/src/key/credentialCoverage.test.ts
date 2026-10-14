import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import { encryptPage, fixtureIv, plaintextPage } from '../wcdb/testing/sqlcipherFixture'
import { inspectDbCredentials } from './credentialCoverage'

let root = ''
const ACCOUNT_ID = 'test-account'
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-coverage-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function file(relativePath: string): WechatDbCredentialBundle['entries'][number] {
  const key = randomBytes(32)
  const salt = randomBytes(16)
  const path = join(root, ACCOUNT_ID, 'db_storage', relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encryptPage(plaintextPage(1, 0x42), key, 1, fixtureIv(1), salt))
  return { relativePath, keyHex: key.toString('hex'), saltHex: salt.toString('hex'), form: 'direct' }
}

describe('inspectDbCredentials', () => {
  it('reports authenticated account coverage and names missing files without revealing material', () => {
    const session = file('session/session.db')
    const contact = file('contact/contact.db')
    file('message/message_0.db')
    const status = inspectDbCredentials({
      dbRoot: root,
      wxid: ACCOUNT_ID,
      dbCredentials: { version: 1, accountId: ACCOUNT_ID, entries: [session, contact] },
    })
    expect(status).toEqual({ database: true, matched: 2, total: 3, missing: ['message/message_0.db'] })
    expect(JSON.stringify(status)).not.toContain(session.keyHex)
    expect(JSON.stringify(status)).not.toContain(contact.keyHex)
  })

  it('requires an authenticated session database even when contacts match', () => {
    file('session/session.db')
    const contact = file('contact/contact.db')
    expect(
      inspectDbCredentials({
        dbRoot: root,
        wxid: ACCOUNT_ID,
        dbCredentials: { version: 1, accountId: ACCOUNT_ID, entries: [contact] },
      }),
    ).toEqual({ database: false, matched: 1, total: 2, missing: ['session/session.db'] })
  })

  it('reports no saved capability for a missing account directory', () => {
    expect(inspectDbCredentials({ dbRoot: root, wxid: ACCOUNT_ID })).toEqual({
      database: false,
      matched: 0,
      total: 0,
      missing: [],
    })
  })

  it('keeps removed saved databases visible as missing coverage', () => {
    const session = file('session/session.db')
    const contact = file('contact/contact.db')
    rmSync(join(root, ACCOUNT_ID, 'db_storage', contact.relativePath))
    expect(
      inspectDbCredentials({
        dbRoot: root,
        wxid: ACCOUNT_ID,
        dbCredentials: { version: 1, accountId: ACCOUNT_ID, entries: [session, contact] },
      }),
    ).toEqual({ database: true, matched: 1, total: 2, missing: ['contact/contact.db'] })
  })
})
