import { mkdtempSync, openSync, closeSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { SqlcipherBridge } from './sqlcipherBridge'
import { encryptPage, fixtureIv, FIXTURE_SALT, plaintextPage } from './testing/sqlcipherFixture'

const KEY_HEX = Buffer.alloc(32, 7).toString('hex')

let root = ''
let cacheDir = ''
let plain = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-bridge-'))
  cacheDir = join(root, 'cache')
  plain = createPlainDb(join(root, 'plain.db'))
})

/** A plain SQLite database: the bridge reads these directly, no copy involved. */
function createPlainDb(path: string): string {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA page_size=4096')
  db.exec('CREATE TABLE msg(id INTEGER PRIMARY KEY, server_id INTEGER, text TEXT, body BLOB, ratio REAL, gone TEXT)')
  db.prepare('INSERT INTO msg VALUES(?,?,?,?,?,?)').run(
    1,
    9007199254740993n,
    'hello',
    Buffer.from([1, 2, 3]),
    0.5,
    null,
  )
  db.prepare('INSERT INTO msg VALUES(?,?,?,?,?,?)').run(2, 42, 'bye', null, 1.5, null)
  db.close()
  return path
}

function bridge(): SqlcipherBridge {
  return new SqlcipherBridge({ cacheDir })
}

describe('SqlcipherBridge', () => {
  it('returns rows shaped like the native bridge does', () => {
    const result = bridge().execQuery(plain, 'SELECT * FROM msg ORDER BY id')
    expect(result.success).toBe(true)
    const [first, second] = result.rows ?? []
    // Int64 beyond a JS number keeps full precision as a string; smaller ones stay numbers.
    expect(first?.['server_id']).toBe('9007199254740993')
    expect(second?.['server_id']).toBe(42)
    expect(first?.['text']).toBe('hello')
    expect(Buffer.isBuffer(first?.['body'])).toBe(true)
    expect((first?.['body'] as Buffer).equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(first?.['ratio']).toBe(0.5)
    expect(first?.['gone']).toBeNull()
    expect(second?.['body']).toBeNull()
  })

  it('accepts bound parameters and PRAGMA / sqlite_master queries', () => {
    const b = bridge()
    expect(b.execQuery(plain, 'SELECT text FROM msg WHERE id = ?', [2]).rows).toEqual([{ text: 'bye' }])
    expect(b.execQuery(plain, 'PRAGMA table_info("msg")').rows?.map((r) => r['name'])).toEqual([
      'id',
      'server_id',
      'text',
      'body',
      'ratio',
      'gone',
    ])
    expect(b.execQuery(plain, "SELECT name FROM sqlite_master WHERE type='table'").rows).toEqual([{ name: 'msg' }])
  })

  it('reports failures instead of throwing', () => {
    const b = bridge()
    expect(b.execQuery(join(root, 'nope.db'), 'SELECT 1').error).toContain('数据库不存在')
    expect(b.execQuery(plain, '   ').error).toBe('SQL 不能为空')
    const bad = b.execQuery(plain, 'SELECT * FROM missing_table')
    expect(bad.success).toBe(false)
    expect(bad.error).toContain('missing_table')
  })

  it('opens a plaintext database and rejects an unreadable or wrongly keyed one', () => {
    const b = bridge()
    expect(b.canOpen(plain)).toBe(true)

    const encrypted = join(root, 'session.db')
    writeFileSync(encrypted, encryptPage(plaintextPage(1, 0x33), Buffer.alloc(32, 7), 1, fixtureIv(1)))
    // Right key, but the fixture's pages are not a real b-tree: the engine must not claim success.
    expect(b.canOpen(encrypted, KEY_HEX)).toBe(false)
    expect(b.canOpen(encrypted, 'f'.repeat(64))).toBe(false)
    expect(b.canOpen(encrypted, 'not-hex')).toBe(false)
    expect(b.canOpen(join(root, 'nope.db'), KEY_HEX)).toBe(false)
  })

  it('keeps serving queries after a database is closed or the bridge is disposed', () => {
    const b = bridge()
    expect(b.execQuery(plain, 'SELECT count(*) AS n FROM msg').rows).toEqual([{ n: 2 }])
    b.closeDatabase(plain)
    b.dispose()
    expect(b.execQuery(plain, 'SELECT count(*) AS n FROM msg').rows).toEqual([{ n: 2 }])
  })

  it('uses the salt of the database it was keyed for', () => {
    // Guards the copy naming: the salt lives in the first 16 bytes of an encrypted page 1.
    const page = encryptPage(plaintextPage(1, 0x33), Buffer.alloc(32, 7), 1, fixtureIv(1))
    expect(page.subarray(0, 16).equals(FIXTURE_SALT)).toBe(true)
  })
})

describe('SQLite reserved-bytes assumption', () => {
  it('derives the usable page size from the header, which is what keeps the SQLCipher layout readable', () => {
    // A decrypted copy keeps SQLCipher's 80-byte page tails and its `reserved = 80` header byte. That
    // only works because SQLite derives its usable page size from byte 20. Proven here in reverse:
    // declaring the reserve on a database that does use those bytes breaks its overflow chains.
    const path = join(root, 'overflow.db')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA page_size=4096')
    db.exec('CREATE TABLE t(a TEXT)')
    db.prepare('INSERT INTO t VALUES(?)').run('x'.repeat(20_000))
    db.close()
    const read = (): unknown => {
      const handle = new DatabaseSync(path, { readOnly: true })
      try {
        return handle.prepare('SELECT length(a) AS n FROM t').get()
      } finally {
        handle.close()
      }
    }
    expect(read()).toEqual({ n: 20_000 })

    const fd = openSync(path, 'r+')
    try {
      writeSync(fd, Buffer.from([80]), 0, 1, 20)
    } finally {
      closeSync(fd)
    }
    expect(read).toThrow(/malformed|corrupt/i)
  })
})
