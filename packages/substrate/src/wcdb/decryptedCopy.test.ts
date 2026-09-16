import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SQLCIPHER_PAGE_SIZE } from '../key/sqlcipherPage'
import { DecryptedCopy } from './decryptedCopy'
import { PAGE_BODY_END } from './sqlcipherCodec'
import {
  buildWal,
  encryptPage,
  expectedPlainPage,
  fixtureIv,
  FIXTURE_SALT,
  plaintextPage,
} from './testing/sqlcipherFixture'

const PAGE = SQLCIPHER_PAGE_SIZE
const KEY = Buffer.alloc(32, 7)
const SALT_HEX = FIXTURE_SALT.toString('hex')

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
  return new DecryptedCopy({ dbPath, key: KEY, saltHex: SALT_HEX, cacheDir, refreshIntervalMs: 0 })
}

function pageOf(bytes: Buffer, pageNumber: number): Buffer {
  return bytes.subarray((pageNumber - 1) * PAGE, pageNumber * PAGE)
}

describe('DecryptedCopy', () => {
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
    const other = new DecryptedCopy({ dbPath, key: KEY, saltHex: 'f'.repeat(32), cacheDir, refreshIntervalMs: 0 })
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

  it('ignores a torn trailing page while WeChat is extending the file', () => {
    writeDb(2)
    writeFileSync(dbPath, readFileSync(dbPath).subarray(0, PAGE + 100))
    touch(dbPath)
    const copy = openCopy()
    expect(copy.refresh()).toBe(true)
    expect(readFileSync(copy.path).length).toBe(PAGE)
  })
})
