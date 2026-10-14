import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import { SQLCIPHER_PAGE_SIZE, SQLCIPHER_RESERVED_SIZE } from '../../key/sqlcipherPage'
import { encryptPage, fixtureIv } from './sqlcipherFixture'

const PAGE = SQLCIPHER_PAGE_SIZE
const BTREE_HEADER_OFFSET = 100
const TABLE_LEAF_PAGE = 13
const CELL_COUNT_OFFSET = 3
const CELL_CONTENT_OFFSET = 5
const CELL_POINTERS_OFFSET = 8

export interface EncryptedDatabaseFixture {
  path: string
  key: Buffer
  salt: Buffer
  pages: Buffer[]
}

/** Compact real SQLite leaf pages with 80 reserved bytes, then encrypt each with SQLCipher 4. */
export function encryptedDatabaseFixture(path: string, sql: string): EncryptedDatabaseFixture {
  mkdirSync(dirname(path), { recursive: true })
  const plainPath = `${path}.fixture-plain`
  const database = new DatabaseSync(plainPath)
  try {
    database.exec(`PRAGMA page_size=${PAGE}`)
    database.exec(sql)
  } finally {
    database.close()
  }
  let bytes: Buffer
  try {
    bytes = readFileSync(plainPath)
  } finally {
    rmSync(plainPath)
  }
  for (let base = 0; base < bytes.length; base += PAGE) {
    const header = base + (base === 0 ? BTREE_HEADER_OFFSET : 0)
    if (bytes[header] !== TABLE_LEAF_PAGE || bytes.readUInt16BE(header + 1) !== 0)
      throw new Error('Fixture requires unfragmented SQLite leaf pages')
    const count = bytes.readUInt16BE(header + CELL_COUNT_OFFSET)
    const start = bytes.readUInt16BE(header + CELL_CONTENT_OFFSET)
    if (start - SQLCIPHER_RESERVED_SIZE <= header - base + CELL_POINTERS_OFFSET + count * 2)
      throw new Error('Fixture has no room for SQLCipher reserved bytes')
    bytes.copy(bytes, base + start - SQLCIPHER_RESERVED_SIZE, base + start, base + PAGE)
    bytes.fill(0, base + PAGE - SQLCIPHER_RESERVED_SIZE, base + PAGE)
    bytes.writeUInt16BE(start - SQLCIPHER_RESERVED_SIZE, header + CELL_CONTENT_OFFSET)
    for (let cell = 0; cell < count; cell += 1) {
      const offset = header + CELL_POINTERS_OFFSET + cell * 2
      bytes.writeUInt16BE(bytes.readUInt16BE(offset) - SQLCIPHER_RESERVED_SIZE, offset)
    }
  }
  bytes[20] = SQLCIPHER_RESERVED_SIZE
  const key = randomBytes(32)
  const salt = randomBytes(16)
  const pages: Buffer[] = []
  for (let base = 0; base < bytes.length; base += PAGE) pages.push(Buffer.from(bytes.subarray(base, base + PAGE)))
  const fixture = { path, key, salt, pages }
  writeFileSync(path, encryptedFixturePages(fixture))
  return fixture
}

/** Re-encrypt complete fixture pages with a fresh IV per page. */
export function encryptedFixturePages(fixture: EncryptedDatabaseFixture): Buffer {
  return Buffer.concat(
    fixture.pages.map((page, index) => encryptPage(page, fixture.key, index + 1, fixtureIv(index + 1), fixture.salt)),
  )
}

/** Synthetic account with independently encrypted session, contact, and message shards. */
export function encryptedAccountFixture(
  root: string,
  accountId: string,
): {
  dbStoragePath: string
  bundle: WechatDbCredentialBundle
  files: EncryptedDatabaseFixture[]
} {
  const storage = join(root, accountId, 'db_storage')
  const session = encryptedDatabaseFixture(
    join(storage, 'session', 'session.db'),
    "CREATE TABLE SessionTable(username TEXT,sort_timestamp INTEGER,last_timestamp INTEGER); INSERT INTO SessionTable VALUES('friend',1700000000,1700000000)",
  )
  const contact = encryptedDatabaseFixture(
    join(storage, 'contact', 'contact.db'),
    `CREATE TABLE contact(username TEXT,nick_name TEXT,flag INTEGER); INSERT INTO contact VALUES('friend','Fixture Friend',1); INSERT INTO contact VALUES('${accountId}','Fixture Owner',1)`,
  )
  const files = [
    session,
    contact,
    encryptedDatabaseFixture(join(storage, 'message', 'message_0.db'), messageFixtureSql(1)),
    encryptedDatabaseFixture(join(storage, 'message', 'message_1.db'), messageFixtureSql(2)),
  ]
  return {
    dbStoragePath: storage,
    files,
    bundle: {
      version: 1,
      accountId,
      entries: files.map((file) => ({
        relativePath: file.path
          .slice(storage.length + 1)
          .split('\\')
          .join('/'),
        saltHex: file.salt.toString('hex'),
        keyHex: file.key.toString('hex'),
        form: 'direct',
      })),
    },
  }
}

/** A small message b-tree that can be overlaid by an authenticated WAL frame in reader tests. */
export function messageFixtureSql(id: number): string {
  const table = `Msg_${createHash('md5').update('friend').digest('hex')}`
  return `CREATE TABLE ${table}(local_id INTEGER,server_id INTEGER,local_type INTEGER,create_time INTEGER,sort_seq INTEGER,message_content TEXT,is_send INTEGER); INSERT INTO ${table} VALUES(${id},${id},1,1700000000,${id},'fixture message ${id}',0)`
}
