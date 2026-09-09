import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findMediaDbs,
  findMessageShards,
  findNamedDb,
  findSessionDbCandidates,
  isAccountDir,
  resolveAccountDir,
  resolveDbStoragePath,
} from './dbFiles'

let root: string
let account: string
let storage: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-dbfiles-'))
  account = join(root, 'wxid_test_1a2b')
  storage = join(account, 'db_storage')
  for (const sub of ['session', 'contact', 'message', 'biz_message', 'media', 'hardlink']) {
    mkdirSync(join(storage, sub), { recursive: true })
  }
  writeFileSync(join(storage, 'session', 'session.db'), 'x')
  writeFileSync(join(storage, 'contact', 'contact.db'), 'x')
  writeFileSync(join(storage, 'message', 'message_0.db'), 'x')
  writeFileSync(join(storage, 'message', 'message_1.db'), 'x')
  writeFileSync(join(storage, 'biz_message', 'biz_message_0.db'), 'x')
  writeFileSync(join(storage, 'media', 'media_0.db'), 'x')
  writeFileSync(join(storage, 'hardlink', 'hardlink.db'), 'x')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('resolveDbStoragePath', () => {
  it('resolves from the parent root via wxid dir', () => {
    expect(resolveDbStoragePath(root, 'wxid_test_1a2b')).toBe(storage)
  })
  it('resolves from the account dir', () => {
    expect(resolveDbStoragePath(account, 'wxid_test_1a2b')).toBe(storage)
  })
  it('resolves when given db_storage itself', () => {
    expect(resolveDbStoragePath(storage, 'wxid_test_1a2b')).toBe(storage)
  })
  it('resolves by wxid prefix when the dir has a suffix', () => {
    expect(resolveDbStoragePath(root, 'wxid_test')).toBe(storage)
  })
  it('rejects another account even for a direct account or storage path', () => {
    expect(resolveDbStoragePath(account, 'wxid_other')).toBeNull()
    expect(resolveDbStoragePath(storage, 'wxid_other')).toBeNull()
  })
  it('returns null for an unrelated path', () => {
    expect(resolveDbStoragePath(join(root, 'nope'), 'x')).toBeNull()
  })
})

describe('account helpers', () => {
  it('recognises an account dir', () => {
    expect(isAccountDir(account)).toBe(true)
    expect(isAccountDir(root)).toBe(false)
  })
  it('resolves the account dir from storage', () => {
    expect(resolveAccountDir(root, 'wxid_test_1a2b')).toBe(account)
  })
})

describe('db discovery', () => {
  it('finds the session db', () => {
    expect(findSessionDbCandidates(storage)[0]).toBe(join(storage, 'session', 'session.db'))
  })
  it('finds named dbs', () => {
    expect(findNamedDb(storage, 'contact.db')).toBe(join(storage, 'contact', 'contact.db'))
    expect(findNamedDb(storage, 'hardlink.db')).toBe(join(storage, 'hardlink', 'hardlink.db'))
    expect(findNamedDb(storage, 'missing.db')).toBeNull()
  })
  it('finds message shards including biz_message, sorted', () => {
    const shards = findMessageShards(storage)
    expect(shards.map((s) => s.kind)).toContain('biz_message')
    expect(shards.filter((s) => s.kind === 'message')).toHaveLength(2)
    expect(shards.map((s) => s.dbPath)).toContain(join(storage, 'message', 'message_0.db'))
  })
  it('finds media dbs', () => {
    expect(findMediaDbs(storage)).toContain(join(storage, 'media', 'media_0.db'))
  })
})
