import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encryptPage, fixtureIv, plaintextPage } from '../wcdb/testing/sqlcipherFixture'
import { createDbKeyResolver } from './dbKeyResolver'
import { deriveSqlcipherKey } from './sqlcipherPage'

let root = ''
const ACCOUNT_ID = 'test-account'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-keyresolver-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function database(name: string, key: Buffer, salt: Buffer = randomBytes(16)): string {
  const path = join(root, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encryptPage(plaintextPage(1, 0x42), key, 1, fixtureIv(1), salt))
  return path
}

function credentials(files: Array<{ path: string; key: Buffer; salt: Buffer }>): WechatDbCredentialBundle {
  return {
    version: 1,
    accountId: ACCOUNT_ID,
    entries: files.map(({ path, key, salt }) => ({
      relativePath: relative(root, path).split('\\').join('/'),
      saltHex: salt.toString('hex'),
      keyHex: key.toString('hex'),
      form: 'direct',
    })),
  }
}

describe('createDbKeyResolver', () => {
  it('opens independently keyed databases using cached credentials without a live process', () => {
    const files = ['session/session.db', 'contact/contact.db', 'message/message_0.db'].map((name) => {
      const key = randomBytes(32)
      const salt = randomBytes(16)
      return { path: database(name, key, salt), key, salt }
    })
    const resolver = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: '',
      dbCredentials: credentials(files),
    })
    for (const file of files) {
      expect(resolver.keyFor(file.path)).toBe(file.key.toString('hex'))
      expect(resolver.keyFor(file.path)).toBe(file.key.toString('hex'))
    }
    resolver.clear()
    expect(resolver.keyFor(files[0]!.path)).toBe(files[0]!.key.toString('hex'))
  })

  it('still accepts a legacy raw account passphrase with each database own salt', () => {
    const passphrase = randomBytes(32)
    const files = ['session/session.db', 'message/message_0.db'].map((name) => {
      const salt = randomBytes(16)
      return database(name, deriveSqlcipherKey(passphrase, salt), salt)
    })
    const resolver = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: passphrase.toString('hex'),
    })
    for (const file of files) expect(resolver.keyFor(file)).toBe(passphrase.toString('hex'))
  })

  it('honours a saved raw form and rejects a credential labelled with the wrong key form', () => {
    const passphrase = randomBytes(32)
    const salt = randomBytes(16)
    const path = database('session/session.db', deriveSqlcipherKey(passphrase, salt), salt)
    const bundle = credentials([{ path, key: passphrase, salt }])
    const wrongForm = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: '',
      dbCredentials: bundle,
    })
    expect(wrongForm.keyFor(path)).toBeUndefined()
    bundle.entries[0]!.form = 'raw'
    const rawForm = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: '',
      dbCredentials: bundle,
    })
    expect(rawForm.keyFor(path)).toBe(passphrase.toString('hex'))
    rawForm.clear()
  })

  it('rejects credentials from another selected account', () => {
    expect(() =>
      createDbKeyResolver({
        accountId: 'different-account',
        dbStoragePath: root,
        sessionKeyHex: '',
        dbCredentials: credentials([]),
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_key' }))
  })

  it('rejects replaced salts even when a legacy direct key would still decrypt the file', () => {
    const key = randomBytes(32)
    const salt = randomBytes(16)
    const path = database('message/message_0.db', key, salt)
    const resolver = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: key.toString('hex'),
      dbCredentials: credentials([{ path, key, salt }]),
    })
    expect(resolver.keyFor(path)).toBe(key.toString('hex'))
    database('message/message_0.db', key)
    expect(resolver.keyFor(path)).toBeUndefined()
  })

  it('authenticates the full first page and refuses an HMAC-tampered cached match', () => {
    const key = randomBytes(32)
    const salt = randomBytes(16)
    const path = database('session/session.db', key, salt)
    const resolver = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: '',
      dbCredentials: credentials([{ path, key, salt }]),
    })
    expect(resolver.keyFor(path)).toBe(key.toString('hex'))
    const page = encryptPage(plaintextPage(1, 0x42), key, 1, fixtureIv(1), salt)
    page[128] = (page[128] ?? 0) ^ 0xff
    writeFileSync(path, page)
    expect(resolver.keyFor(path)).toBeUndefined()
  })

  it('reports missing shards and does not try another file credential against them', () => {
    const key = randomBytes(32)
    const salt = randomBytes(16)
    const path = database('session/session.db', key, salt)
    const shard = database('message/message_0.db', randomBytes(32))
    const resolver = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: '',
      dbCredentials: credentials([{ path, key, salt }]),
    })
    expect(resolver.keyFor(shard)).toBeUndefined()
    expect(resolver.keyFor(join(root, 'missing.db'))).toBeUndefined()
  })

  it('refuses a saved encrypted database replaced by a plaintext file', () => {
    const key = randomBytes(32)
    const salt = randomBytes(16)
    const path = database('session/session.db', key, salt)
    const resolver = createDbKeyResolver({
      accountId: ACCOUNT_ID,
      dbStoragePath: root,
      sessionKeyHex: key.toString('hex'),
      dbCredentials: credentials([{ path, key, salt }]),
    })
    writeFileSync(path, plaintextPage(1, 0x42))
    expect(resolver.keyFor(path)).toBeUndefined()
  })

  it('rejects credentials and database paths that escape their database root', () => {
    const bundle = credentials([])
    bundle.entries.push({
      relativePath: '../outside.db',
      saltHex: 'a'.repeat(32),
      keyHex: 'a'.repeat(64),
      form: 'direct',
    })
    expect(() =>
      createDbKeyResolver({ accountId: ACCOUNT_ID, dbStoragePath: root, sessionKeyHex: '', dbCredentials: bundle }),
    ).toThrow(expect.objectContaining({ code: 'invalid_key' }))
    const resolver = createDbKeyResolver({ accountId: ACCOUNT_ID, dbStoragePath: root, sessionKeyHex: 'a'.repeat(64) })
    expect(resolver.keyFor(join(root, '..', 'outside.db'))).toBeUndefined()
  })

  it('rejects a database symlink pointing outside the selected account', () => {
    const outside = mkdtempSync(join(tmpdir(), 'aiwc-outside-'))
    try {
      const key = randomBytes(32)
      const salt = randomBytes(16)
      const outsidePath = join(outside, 'session.db')
      writeFileSync(outsidePath, encryptPage(plaintextPage(1, 0x42), key, 1, fixtureIv(1), salt))
      const path = join(root, 'session.db')
      symlinkSync(outsidePath, path)
      const resolver = createDbKeyResolver({
        accountId: ACCOUNT_ID,
        dbStoragePath: root,
        sessionKeyHex: '',
        dbCredentials: credentials([{ path, key, salt }]),
      })
      expect(resolver.keyFor(path)).toBeUndefined()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
