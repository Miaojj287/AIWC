import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listAccounts, verifyAccount } from './accounts'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-accounts-'))
  for (const name of ['wxid_a_1111', 'wxid_b_2222']) {
    mkdirSync(join(root, name, 'db_storage', 'session'), { recursive: true })
    writeFileSync(join(root, name, 'db_storage', 'session', 'session.db'), 'x')
  }
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('listAccounts', () => {
  it('enumerates wxid dirs under a root', async () => {
    const accounts = await listAccounts(root)
    expect(accounts.map((a) => a.wxid).sort()).toEqual(['wxid_a_1111', 'wxid_b_2222'])
    expect(accounts.every((a) => a.dbRoot === root && a.verified === false)).toBe(true)
  })
  it('accepts a db_storage directory copied from an existing setup', async () => {
    const accounts = await listAccounts(join(root, 'wxid_a_1111', 'db_storage'))
    expect(accounts).toEqual([{ wxid: 'wxid_a_1111', dbRoot: root, verified: false }])
  })
  it('treats an account dir directly', async () => {
    const accounts = await listAccounts(join(root, 'wxid_a_1111'))
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.wxid).toBe('wxid_a_1111')
  })
})

describe('verifyAccount', () => {
  it('validates directory shape without a key', async () => {
    expect(await verifyAccount({ dbRoot: root, wxid: 'wxid_a_1111' })).toEqual({ ok: true })
  })
  it('fails for a missing account', async () => {
    const result = await verifyAccount({ dbRoot: root, wxid: 'wxid_missing' })
    expect(result.ok).toBe(false)
  })
  it('reports a key mismatch (dummy session.db, any key)', async () => {
    const result = await verifyAccount({ dbRoot: root, wxid: 'wxid_a_1111', dbKeyHex: 'a'.repeat(64) })
    expect(result.ok).toBe(false)
  })
})
