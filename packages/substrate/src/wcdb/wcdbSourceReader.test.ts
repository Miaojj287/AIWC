import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardSelectSql } from '../shared/sqlGuard'
import { createMirror } from '../mirror'
import { createSubstrateFacade } from '../facade'
import { WcdbSourceReader } from './wcdbSourceReader'
import { encryptedAccountFixture, encryptedDatabaseFixture, messageFixtureSql } from './testing/encryptedAccountFixture'
import { buildWal, encryptPage, fixtureIv } from './testing/sqlcipherFixture'

const ACCOUNT_ID = 'test-account'
let root = ''
let reader: WcdbSourceReader

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-reader-'))
  vi.stubEnv('AIWC_WCDB_ENGINE', 'sqlcipher')
  reader = new WcdbSourceReader({ nativeDir: '' })
})
afterEach(async () => {
  await reader.close()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

async function openFixture(bundle = encryptedAccountFixture(root, ACCOUNT_ID).bundle): Promise<void> {
  await reader.open({
    dbRoot: root,
    wxid: ACCOUNT_ID,
    dbKeyHex: '',
    dbCredentials: bundle,
    cacheDir: join(root, 'cache'),
  })
}

describe('WcdbSourceReader with saved per-database credentials', () => {
  it('reads real SQLite tables across independent keys and reopens without process access', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    const sourceBytes = fixture.files.map((file) => readFileSync(file.path))
    await openFixture(fixture.bundle)
    expect((await reader.account()).verified).toBe(true)
    expect((await reader.sessions()).map((session) => session.title)).toEqual(['Fixture Friend'])
    expect((await reader.contacts()).map((contact) => contact.username).sort()).toEqual(['friend', ACCOUNT_ID].sort())
    expect((await reader.messagesBefore('friend', Number.MAX_SAFE_INTEGER, 20)).map((message) => message.seq)).toEqual([
      2, 1,
    ])
    await reader.close()
    await openFixture(fixture.bundle)
    expect((await reader.messagesAfter('friend', 0, 20)).map((message) => message.seq)).toEqual([1, 2])
    fixture.files.forEach((file, index) => expect(readFileSync(file.path).equals(sourceBytes[index]!)).toBe(true))
    for (const directory of ['session', 'contact', 'message'])
      expect(readdirSync(join(fixture.dbStoragePath, directory)).every((name) => name.endsWith('.db'))).toBe(true)
  })

  it('opens a session-only credential without inventing empty contact or message results', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    fixture.bundle.entries = fixture.bundle.entries.filter((entry) => entry.relativePath === 'session/session.db')
    await openFixture(fixture.bundle)
    expect((await reader.account()).verified).toBe(true)
    expect((await reader.sessions()).map((session) => session.id)).toEqual(['friend'])
    await expect(reader.contacts()).rejects.toMatchObject({ code: 'locked' })
    await expect(reader.groupMembers('fixture@chatroom')).rejects.toMatchObject({ code: 'locked' })
    await expect(reader.messagesBefore('friend', Number.MAX_SAFE_INTEGER, 20)).rejects.toMatchObject({ code: 'locked' })
  })

  it('refuses an incomplete message set instead of silently returning one unlocked shard', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    fixture.bundle.entries = fixture.bundle.entries.filter((entry) => entry.relativePath !== 'message/message_1.db')
    await openFixture(fixture.bundle)
    await expect(reader.messagesAfter('friend', 0, 20)).rejects.toMatchObject({ code: 'locked' })
    await expect(
      reader.querySql('message', guardSelectSql('SELECT name FROM sqlite_master', 20)),
    ).rejects.toMatchObject({ code: 'locked' })
  })

  it('rejects a replaced shard even when the old table index has already been cached', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    await openFixture(fixture.bundle)
    expect(await reader.messagesAfter('friend', 0, 20)).toHaveLength(2)
    const shard = fixture.files[2]!
    writeFileSync(
      shard.path,
      Buffer.concat(
        shard.pages.map((page, index) =>
          encryptPage(page, shard.key, index + 1, fixtureIv(index + 10), randomBytes(16)),
        ),
      ),
    )
    await expect(reader.messagesAfter('friend', 0, 20)).rejects.toMatchObject({ code: 'locked' })
  })

  it('reads a committed, authenticated WAL overlay through the persisted shard key', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    const shard = fixture.files[2]!
    const newer = encryptedDatabaseFixture(join(root, 'newer.db'), messageFixtureSql(3))
    const payload = encryptPage(newer.pages[1]!, shard.key, 2, fixtureIv(99), shard.salt)
    writeFileSync(`${shard.path}-wal`, buildWal({ frames: [{ pageNumber: 2, dbSize: shard.pages.length, payload }] }))
    await openFixture(fixture.bundle)
    expect((await reader.messagesAfter('friend', 0, 20)).map((message) => message.seq)).toEqual([2, 3])
    await reader.close()
    await openFixture(fixture.bundle)
    expect((await reader.messagesBefore('friend', Number.MAX_SAFE_INTEGER, 20)).map((message) => message.seq)).toEqual([
      3, 2,
    ])
  })

  it('rejects another account bundle before opening a database', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    fixture.bundle.accountId = 'other-account'
    await expect(openFixture(fixture.bundle)).rejects.toMatchObject({ code: 'invalid_key' })
    expect(reader.isOpen()).toBe(false)
  })

  it('selects the source read-only copy engine for bundles even when native WCDB is requested', async () => {
    vi.stubEnv('AIWC_WCDB_ENGINE', 'wcdb')
    await openFixture()
    expect((await reader.messagesAfter('friend', 0, 20)).length).toBe(2)
  })

  it('does not interpret disappeared message shards as an empty history', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    rmSync(fixture.files[2]!.path)
    rmSync(fixture.files[3]!.path)
    await openFixture(fixture.bundle)
    await expect(reader.messagesAfter('friend', 0, 20)).rejects.toMatchObject({ code: 'locked' })
  })

  it('keeps a disappeared saved contact database locked without hiding sessions', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    rmSync(fixture.files[1]!.path)
    await openFixture(fixture.bundle)
    expect(await reader.sessions()).toHaveLength(1)
    await expect(reader.contacts()).rejects.toMatchObject({ code: 'locked' })
    await expect(reader.groupMembers('fixture@chatroom')).rejects.toMatchObject({ code: 'locked' })
  })

  it('leaves the sync watermark unchanged when a required shard remains locked', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    fixture.bundle.entries = fixture.bundle.entries.filter((entry) => entry.relativePath !== 'message/message_1.db')
    const mirror = createMirror({ dbPath: join(root, 'mirror.db') })
    const facade = createSubstrateFacade({
      source: reader,
      mirror,
      cacheDir: join(root, 'cache'),
      autoSyncOnOpen: false,
    })
    try {
      await facade.openWith({
        dbRoot: root,
        wxid: ACCOUNT_ID,
        dbKeyHex: '',
        dbCredentials: fixture.bundle,
        cacheDir: join(root, 'cache'),
      })
      expect((await facade.sync()).phase).toBe('error')
      expect(mirror.watermark('friend')).toBe(0)
      expect(mirror.countMessages()).toBe(0)
      await expect(facade.listMessages({ sessionId: 'friend', limit: 20 })).rejects.toMatchObject({ code: 'locked' })
    } finally {
      await facade.close()
      mirror.close()
    }
  })
})
