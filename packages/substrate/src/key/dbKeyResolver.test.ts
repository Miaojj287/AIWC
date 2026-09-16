import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptPage, plaintextPage } from '../wcdb/testing/sqlcipherFixture'
import { createDbKeyResolver } from './dbKeyResolver'
import { deriveSqlcipherKey } from './sqlcipherPage'

const dir = mkdtempSync(join(tmpdir(), 'aiwc-keyresolver-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let clock = 0

beforeEach(() => {
  clock = 1_000_000
})

const now = (): number => clock

/** A database whose pages SQLCipher decrypts with `aesKey` as is (the Windows shape). */
function directDb(name: string, aesKey: Buffer): string {
  const path = join(dir, name)
  writeFileSync(path, encryptPage(plaintextPage(1, 0x42), aesKey, 1, randomBytes(16)))
  return path
}

describe('createDbKeyResolver', () => {
  it('uses the account key for every database that accepts it', () => {
    // macOS shape: one passphrase, PBKDF2 applied per file with that file's own salt.
    const passphrase = randomBytes(32)
    const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
    const session = directDb('mac-session.db', deriveSqlcipherKey(passphrase, salt))
    const collectCandidates = vi.fn(() => [])
    const resolver = createDbKeyResolver({ sessionKeyHex: passphrase.toString('hex'), collectCandidates, now })

    expect(resolver.keyFor(session)).toBe(passphrase.toString('hex'))
    // Nothing had to be scanned out of the running process.
    expect(collectCandidates).not.toHaveBeenCalled()
  })

  it('matches a per-database key from the candidates WeChat has in memory', () => {
    // Windows shape: session.db and the message shard carry different already-derived keys.
    const sessionKey = randomBytes(32)
    const shardKey = randomBytes(32)
    const session = directDb('win-session.db', sessionKey)
    const shard = directDb('win-message_0.db', shardKey)
    const collectCandidates = vi.fn(() => [randomBytes(32).toString('hex'), shardKey.toString('hex')])
    const resolver = createDbKeyResolver({ sessionKeyHex: sessionKey.toString('hex'), collectCandidates, now })

    expect(resolver.keyFor(session)).toBe(sessionKey.toString('hex'))
    expect(resolver.keyFor(shard)).toBe(shardKey.toString('hex'))
    expect(collectCandidates).toHaveBeenCalledTimes(1)

    // Both are cached: resolving again costs no further walks.
    expect(resolver.keyFor(shard)).toBe(shardKey.toString('hex'))
    expect(collectCandidates).toHaveBeenCalledTimes(1)
  })

  it('reports no key and stops walking the process for a while', () => {
    const shard = directDb('unknown-message_0.db', randomBytes(32))
    const collectCandidates = vi.fn(() => [])
    const logger = vi.fn()
    const resolver = createDbKeyResolver({
      sessionKeyHex: randomBytes(32).toString('hex'),
      collectCandidates,
      now,
      logger,
    })

    expect(resolver.keyFor(shard)).toBeUndefined()
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('no key matches'), expect.anything())
    // A miss must not re-walk WeChat on every query of that shard.
    expect(resolver.keyFor(shard)).toBeUndefined()
    expect(collectCandidates).toHaveBeenCalledTimes(1)

    // …but it is retried later, in case WeChat has since opened that database.
    clock += 31_000
    const found = directDb('unknown-message_0.db', randomBytes(32))
    expect(found).toBe(shard)
    expect(resolver.keyFor(shard)).toBeUndefined()
    expect(collectCandidates).toHaveBeenCalledTimes(2)
  })

  it('re-collects candidates once the last walk is stale', () => {
    const shardKey = randomBytes(32)
    const shard = directDb('late-message_0.db', shardKey)
    let opened = false
    const collectCandidates = vi.fn(() => (opened ? [shardKey.toString('hex')] : []))
    const resolver = createDbKeyResolver({
      sessionKeyHex: randomBytes(32).toString('hex'),
      collectCandidates,
      now,
    })

    expect(resolver.keyFor(shard)).toBeUndefined()
    opened = true
    clock += 31_000
    expect(resolver.keyFor(shard)).toBe(shardKey.toString('hex'))
  })

  it('ignores a database it cannot read', () => {
    const resolver = createDbKeyResolver({
      sessionKeyHex: randomBytes(32).toString('hex'),
      collectCandidates: () => [],
      now,
    })
    expect(resolver.keyFor(join(dir, 'missing.db'))).toBeUndefined()
  })
})
