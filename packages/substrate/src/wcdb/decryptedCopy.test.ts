import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { SQLCIPHER_PAGE_SIZE } from '../key/sqlcipherPage'
import { DecryptedCopy } from './decryptedCopy'
import { PAGE_BODY_END } from './sqlcipherCodec'
import { encryptedDatabaseFixture } from './testing/encryptedAccountFixture'
import {
  buildWal,
  encryptPage,
  expectedPlainPage,
  fixtureCipher,
  fixtureIv,
  plaintextPage,
} from './testing/sqlcipherFixture'

const PAGE = SQLCIPHER_PAGE_SIZE
const KEY = Buffer.alloc(32, 7)

let root = ''
let dbPath = ''
let cacheDir = ''
let clock = 0

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-copy-'))
  dbPath = join(root, 'session.db')
  cacheDir = join(root, 'cache')
  clock = 1_700_000_000
})

/** An encrypted database of `pages` pages; page N is filled with marker N and IV seed 10 + N. */
function writeDb(count: number): Buffer[] {
  const plain: Buffer[] = []
  const encrypted: Buffer[] = []
  for (let page = 1; page <= count; page += 1) {
    const body = plaintextPage(page, page)
    plain.push(body)
    encrypted.push(encryptPage(body, KEY, page, fixtureIv(10 + page)))
  }
  writeFileSync(dbPath, Buffer.concat(encrypted))
  touch(dbPath)
  return plain
}

function writePage(path: string, pageNumber: number, page: Buffer): void {
  const fd = openSync(path, 'r+')
  try {
    writeSync(fd, page, 0, PAGE, (pageNumber - 1) * PAGE)
  } finally {
    closeSync(fd)
  }
  touch(path)
}

/** Distinct mtimes make the freshness check deterministic regardless of filesystem resolution. */
function touch(path: string): void {
  clock += 10
  utimesSync(path, new Date(clock * 1000), new Date(clock * 1000))
}

function openCopy(): DecryptedCopy {
  return new DecryptedCopy({ dbPath, cipher: fixtureCipher(KEY), cacheDir, refreshIntervalMs: 0 })
}

function pageOf(bytes: Buffer, pageNumber: number): Buffer {
  return bytes.subarray((pageNumber - 1) * PAGE, pageNumber * PAGE)
}

function writeDeclaredExtent(declared: number, counter = 7, validFor = counter): void {
  const header = plaintextPage(1, 1)
  header.writeUInt32BE(declared, 28)
  header.writeUInt32BE(counter, 24)
  header.writeUInt32BE(validFor, 92)
  writePage(dbPath, 1, encryptPage(header, KEY, 1, fixtureIv(11)))
}

describe('DecryptedCopy', () => {
  it('reads a real SQLite copy with preallocated zero tail without modifying its source', () => {
    const fixture = encryptedDatabaseFixture(
      dbPath,
      'CREATE TABLE fixture(value INTEGER); INSERT INTO fixture VALUES(37)',
    )
    const source = Buffer.concat([readFileSync(dbPath), Buffer.alloc(6 * PAGE)])
    writeFileSync(dbPath, source)
    const copy = new DecryptedCopy({ dbPath, cipher: fixtureCipher(fixture.key, fixture.salt), cacheDir })
    expect(copy.refresh()).toBe(true)
    expect(statSync(copy.path).size).toBe(fixture.pages.length * PAGE)
    const database = new DatabaseSync(copy.path, { readOnly: true })
    try {
      expect(database.prepare('SELECT value FROM fixture').get()?.['value']).toBe(37)
    } finally {
      database.close()
    }
    expect(readFileSync(dbPath).equals(source)).toBe(true)
  })

  it('rejects corruption inside the logical extent even when the cached IV is unchanged', () => {
    writeDb(3)
    writeDeclaredExtent(3)
    const copy = openCopy()
    copy.refresh()
    const corrupt = Buffer.from(pageOf(readFileSync(dbPath), 2))
    corrupt[100] = (corrupt[100] ?? 0) ^ 1
    writePage(dbPath, 2, corrupt)
    expect(() => copy.refresh()).toThrow()
  })

  it.each([
    [0, 7, 7],
    [1, 7, 8],
  ])('copies every physical page when the logical count is invalid (%i/%i/%i)', (declared, counter, validFor) => {
    writeDb(3)
    writeDeclaredExtent(declared, counter, validFor)
    const copy = openCopy()
    copy.refresh()
    expect(statSync(copy.path).size).toBe(3 * PAGE)
  })

  it('refreshes the header when logical size shrinks without changing its IV or physical extent', () => {
    writeDb(3)
    writeDeclaredExtent(3)
    const copy = openCopy()
    copy.refresh()
    writeDeclaredExtent(2)
    expect(copy.refresh()).toBe(true)
    expect(statSync(copy.path).size).toBe(2 * PAGE)
    expect(readFileSync(copy.path).readUInt32BE(28)).toBe(2)
    expect(statSync(dbPath).size).toBe(3 * PAGE)
  })

  it('preserves WAL growth and shrink commits over a preallocated main file', () => {
    writeDb(2)
    writeDeclaredExtent(2)
    writeFileSync(dbPath, Buffer.concat([readFileSync(dbPath), Buffer.alloc(6 * PAGE)]))
    touch(dbPath)
    const copy = openCopy()
    copy.refresh()
    writeFileSync(
      `${dbPath}-wal`,
      buildWal({
        frames: [
          { pageNumber: 3, dbSize: 0, payload: encryptPage(plaintextPage(3, 3), KEY, 3, fixtureIv(33)) },
          { pageNumber: 4, dbSize: 4, payload: encryptPage(plaintextPage(4, 4), KEY, 4, fixtureIv(34)) },
        ],
      }),
    )
    touch(`${dbPath}-wal`)
    expect(copy.refresh()).toBe(true)
    expect(statSync(copy.path).size).toBe(4 * PAGE)
    const header = plaintextPage(1, 1)
    header.writeUInt32BE(1, 28)
    writeFileSync(
      `${dbPath}-wal`,
      buildWal({
        salt: Buffer.alloc(8, 0x55),
        frames: [{ pageNumber: 1, dbSize: 1, payload: encryptPage(header, KEY, 1, fixtureIv(35)) }],
      }),
    )
    touch(`${dbPath}-wal`)
    expect(copy.refresh()).toBe(true)
    expect(statSync(copy.path).size).toBe(PAGE)
    expect(statSync(dbPath).size).toBe(8 * PAGE)
  })
  it('materializes every page of the encrypted database', () => {
    const plain = writeDb(3)
    const copy = openCopy()
    expect(copy.refresh()).toBe(true)

    const bytes = readFileSync(copy.path)
    expect(bytes.length).toBe(3 * PAGE)
    for (let page = 1; page <= 3; page += 1) {
      const encrypted = encryptPage(plain[page - 1]!, KEY, page, fixtureIv(10 + page))
      expect(pageOf(bytes, page).equals(expectedPlainPage(plain[page - 1]!, page, encrypted))).toBe(true)
    }
  })

  it('reports no change when nothing was written', () => {
    writeDb(2)
    const copy = openCopy()
    expect(copy.refresh()).toBe(true)
    expect(copy.refresh()).toBe(false)
  })

  it('re-decrypts only the pages whose IV moved', () => {
    writeDb(3)
    const copy = openCopy()
    copy.refresh()

    // A sentinel inside the copy survives only if that page is not rewritten.
    writePage(copy.path, 2, Buffer.alloc(PAGE, 0xc7))
    const updated = plaintextPage(3, 0x5e)
    writePage(dbPath, 3, encryptPage(updated, KEY, 3, fixtureIv(99)))

    expect(copy.refresh()).toBe(true)
    const bytes = readFileSync(copy.path)
    expect(pageOf(bytes, 2).every((b) => b === 0xc7)).toBe(true)
    expect(pageOf(bytes, 3).subarray(0, PAGE_BODY_END).equals(updated.subarray(0, PAGE_BODY_END))).toBe(true)
  })

  it('reuses an existing copy across restarts', () => {
    writeDb(3)
    openCopy().refresh()
    // A fresh instance reads the IVs back out of the copy instead of decrypting everything again.
    expect(openCopy().refresh()).toBe(false)
  })

  it('overlays committed WAL frames and restores the page after a checkpoint', () => {
    const plain = writeDb(3)
    const copy = openCopy()
    copy.refresh()

    const fromWal = plaintextPage(2, 0x21)
    writeFileSync(
      `${dbPath}-wal`,
      buildWal({
        frames: [{ pageNumber: 2, dbSize: 3, payload: encryptPage(fromWal, KEY, 2, fixtureIv(77)) }],
      }),
    )
    touch(`${dbPath}-wal`)
    expect(copy.refresh()).toBe(true)
    let bytes = readFileSync(copy.path)
    expect(pageOf(bytes, 2).subarray(0, PAGE_BODY_END).equals(fromWal.subarray(0, PAGE_BODY_END))).toBe(true)
    // Zeroed tail = "this page came from the WAL", so the next main pass revisits it.
    expect(
      pageOf(bytes, 2)
        .subarray(PAGE_BODY_END)
        .every((b) => b === 0),
    ).toBe(true)
    expect(copy.refresh()).toBe(false)

    // Checkpoint: WeChat folds the frame into the main file (new IV) and resets the WAL.
    rmSync(`${dbPath}-wal`)
    writePage(dbPath, 2, encryptPage(plain[1]!, KEY, 2, fixtureIv(78)))
    expect(copy.refresh()).toBe(true)
    bytes = readFileSync(copy.path)
    expect(pageOf(bytes, 2).subarray(0, PAGE_BODY_END).equals(plain[1]!.subarray(0, PAGE_BODY_END))).toBe(true)
  })

  it('follows the committed page count when the WAL grows or shrinks the database', () => {
    writeDb(3)
    const copy = openCopy()
    copy.refresh()

    const grown = plaintextPage(4, 0x44)
    writeFileSync(
      `${dbPath}-wal`,
      buildWal({ frames: [{ pageNumber: 4, dbSize: 4, payload: encryptPage(grown, KEY, 4, fixtureIv(44)) }] }),
    )
    touch(`${dbPath}-wal`)
    copy.refresh()
    expect(readFileSync(copy.path).length).toBe(4 * PAGE)

    rmSync(`${dbPath}-wal`)
    writeDb(2)
    copy.refresh()
    expect(readFileSync(copy.path).length).toBe(2 * PAGE)
  })

  it('never reuses a copy made from a different database salt', () => {
    writeDb(2)
    const first = openCopy()
    first.refresh()
    const other = new DecryptedCopy({
      dbPath,
      cipher: fixtureCipher(KEY, Buffer.alloc(16, 0xff)),
      cacheDir,
      refreshIntervalMs: 0,
    })
    expect(other.path).not.toBe(first.path)
    expect(existsSync(first.path)).toBe(false)
    expect(readdirSync(join(cacheDir, 'wcdb-plain'))).toEqual([])
  })

  it('removes the copy on request and rebuilds it afterwards', () => {
    writeDb(2)
    const copy = openCopy()
    copy.refresh()
    copy.remove()
    expect(existsSync(copy.path)).toBe(false)
    expect(copy.refresh()).toBe(true)
    expect(readFileSync(copy.path).length).toBe(2 * PAGE)
  })

  it('drops the plaintext when the source database is truncated away', () => {
    writeDb(3)
    const copy = openCopy()
    copy.refresh()
    expect(readFileSync(copy.path).length).toBe(3 * PAGE)

    // WeChat (or the user) empties the file. A copy longer than its source keeps serving chat
    // history that no longer exists, so the refresh has to cut it back to the committed size.
    writeFileSync(dbPath, Buffer.alloc(0))
    touch(dbPath)
    expect(copy.refresh()).toBe(true)
    expect(readFileSync(copy.path).length).toBe(0)
  })

  it('rejects a torn trailing page instead of silently accepting an incomplete physical extent', () => {
    writeDb(2)
    writeFileSync(dbPath, readFileSync(dbPath).subarray(0, PAGE + 100))
    touch(dbPath)
    const copy = openCopy()
    expect(() => copy.refresh()).toThrow()
  })
})

// Windows has no POSIX modes; the cache inherits the user profile's ACL there.
describe.skipIf(process.platform === 'win32')('DecryptedCopy permissions', () => {
  const mode = (path: string): number => statSync(path).mode & 0o777

  it('keeps the plaintext copy and its directory owner-only', () => {
    writeDb(2)
    const copy = openCopy()
    copy.refresh()
    expect(mode(copy.path)).toBe(0o600)
    expect(mode(join(cacheDir, 'wcdb-plain'))).toBe(0o700)
  })

  it('tightens a world-readable copy left behind by an earlier build', () => {
    writeDb(2)
    const first = openCopy()
    first.refresh()
    const dir = join(cacheDir, 'wcdb-plain')
    chmodSync(dir, 0o755)
    chmodSync(first.path, 0o644)

    const copy = openCopy()
    copy.refresh()
    expect(mode(copy.path)).toBe(0o600)
    expect(mode(dir)).toBe(0o700)
  })
})
