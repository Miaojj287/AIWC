import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SQLCIPHER_PAGE_SIZE } from '../key/sqlcipherPage'
import { readWalSnapshot, walChecksum } from './sqliteWal'
import { buildWal } from './testing/sqlcipherFixture'

const PAGE = SQLCIPHER_PAGE_SIZE

function walFile(bytes: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), 'aiwc-wal-')), 'db.db-wal')
  writeFileSync(path, bytes)
  return path
}

function payload(marker: number): Buffer {
  return Buffer.alloc(PAGE, marker)
}

describe('walChecksum', () => {
  it('sums 8-byte blocks into two running words', () => {
    expect(walChecksum(Buffer.from([0, 0, 0, 1, 0, 0, 0, 2]), true, 0, 0)).toEqual([1, 3])
  })

  it('wraps at 32 bits', () => {
    const data = Buffer.alloc(8)
    data.writeUInt32BE(0xffffffff, 0)
    data.writeUInt32BE(1, 4)
    expect(walChecksum(data, true, 0, 0)).toEqual([0xffffffff, 0])
  })

  it('reads little-endian words when the magic says so', () => {
    const data = Buffer.from([1, 0, 0, 0, 2, 0, 0, 0])
    expect(walChecksum(data, false, 0, 0)).toEqual([1, 3])
  })
})

describe('readWalSnapshot', () => {
  it('keeps the newest frame per page up to the last commit', () => {
    const path = walFile(
      buildWal({
        frames: [
          { pageNumber: 2, dbSize: 0, payload: payload(1) },
          { pageNumber: 2, dbSize: 0, payload: payload(2) },
          { pageNumber: 5, dbSize: 5, payload: payload(3) },
        ],
      }),
    )
    const snapshot = readWalSnapshot(path, PAGE)
    expect(snapshot?.dbSizePages).toBe(5)
    expect([...(snapshot?.frames.keys() ?? [])].sort()).toEqual([2, 5])
    // Second frame for page 2 wins: header 32 + frame 1 + frame 2 header.
    expect(snapshot?.frames.get(2)?.offset).toBe(32 + (24 + PAGE) + 24)
  })

  it('drops frames written after the last commit', () => {
    const path = walFile(
      buildWal({
        frames: [
          { pageNumber: 1, dbSize: 1, payload: payload(1) },
          { pageNumber: 3, dbSize: 0, payload: payload(2) },
        ],
      }),
    )
    const snapshot = readWalSnapshot(path, PAGE)
    expect([...(snapshot?.frames.keys() ?? [])]).toEqual([1])
    expect(snapshot?.dbSizePages).toBe(1)
  })

  it('stops at a frame whose checksum or salt does not fit the chain', () => {
    const broken = walFile(
      buildWal({
        frames: [
          { pageNumber: 1, dbSize: 1, payload: payload(1) },
          { pageNumber: 2, dbSize: 2, payload: payload(2) },
        ],
        breakFrameAt: 1,
      }),
    )
    expect(readWalSnapshot(broken, PAGE)?.dbSizePages).toBe(1)

    const stale = walFile(
      buildWal({
        frames: [
          { pageNumber: 1, dbSize: 1, payload: payload(1) },
          { pageNumber: 2, dbSize: 2, payload: payload(2) },
        ],
        foreignSaltAt: 1,
      }),
    )
    expect(readWalSnapshot(stale, PAGE)?.dbSizePages).toBe(1)
  })

  it('returns null without a usable commit, for a foreign page size and for a missing file', () => {
    const uncommitted = walFile(buildWal({ frames: [{ pageNumber: 1, dbSize: 0, payload: payload(1) }] }))
    expect(readWalSnapshot(uncommitted, PAGE)).toBeNull()

    const otherPageSize = walFile(
      buildWal({ pageSize: 1024, frames: [{ pageNumber: 1, dbSize: 1, payload: Buffer.alloc(1024, 1) }] }),
    )
    expect(readWalSnapshot(otherPageSize, PAGE)).toBeNull()

    expect(readWalSnapshot(join(tmpdir(), 'aiwc-missing.db-wal'), PAGE)).toBeNull()
  })

  it('accepts little-endian checksum arithmetic', () => {
    const path = walFile(buildWal({ bigEndian: false, frames: [{ pageNumber: 7, dbSize: 7, payload: payload(9) }] }))
    expect(readWalSnapshot(path, PAGE)?.frames.get(7)?.offset).toBe(32 + 24)
  })
})
