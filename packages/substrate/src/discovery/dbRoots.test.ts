import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMacVersionDir, isPotentialAccountName, listAccountDirs, scoreRootCandidates } from './dbRoots'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-roots-'))
  // Two accounts + one junk dir; account "b" is newer.
  for (const name of ['wxid_a_1111', 'wxid_b_2222', 'backup']) {
    mkdirSync(join(root, name, 'db_storage', 'session'), { recursive: true })
    writeFileSync(join(root, name, 'db_storage', 'session', 'session.db'), 'x')
  }
  const older = new Date(Date.now() - 60_000)
  utimesSync(join(root, 'wxid_a_1111', 'db_storage'), older, older)
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('name predicates', () => {
  it('detects mac version dirs', () => {
    expect(isMacVersionDir('4.0.6.15')).toBe(true)
    expect(isMacVersionDir('4.1b2.5')).toBe(true)
    expect(isMacVersionDir('wxid_x')).toBe(false)
  })
  it('rejects non-account directory names', () => {
    expect(isPotentialAccountName('wxid_a_1111')).toBe(true)
    expect(isPotentialAccountName('backup')).toBe(false)
    expect(isPotentialAccountName('.DS_Store')).toBe(false)
  })
})

describe('listAccountDirs', () => {
  it('lists accounts newest first, excluding junk', () => {
    const accounts = listAccountDirs(root)
    expect(accounts).not.toContain('backup')
    expect(accounts[0]).toBe('wxid_b_2222')
    expect(accounts).toContain('wxid_a_1111')
  })
})

describe('scoreRootCandidates', () => {
  it('ranks an existing multi-account root above a nonexistent one', () => {
    const scored = scoreRootCandidates([root, join(root, 'nope')], 'darwin')
    expect(scored).toHaveLength(1)
    expect(scored[0]?.path).toBe(root)
    expect(scored[0]?.accountCount).toBe(2)
  })
  it('treats an account dir directly as a candidate', () => {
    const scored = scoreRootCandidates([join(root, 'wxid_b_2222')], 'win32')
    expect(scored[0]?.accountCount).toBe(1)
  })
})
