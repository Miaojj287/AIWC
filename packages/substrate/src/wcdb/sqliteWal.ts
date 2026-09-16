/**
 * Read-only SQLite WAL reader: finds the pages a live WeChat database has committed but not yet
 * checkpointed into its main file. WCDB runs in WAL mode, so a decrypted copy built from the main
 * file alone would silently miss recent messages.
 *
 * Format per https://sqlite.org/fileformat2.html#walformat: a 32-byte header followed by frames of a
 * 24-byte header plus one page, all big-endian. Frames count only up to the last commit frame whose
 * running checksum still matches — the same rule SQLite applies when it recovers a WAL, which also
 * makes a concurrently written (torn) tail harmless.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'

const WAL_HEADER_SIZE = 32
const WAL_FRAME_HEADER_SIZE = 24
/** Magic with the low bit cleared; the low bit selects big-endian checksum arithmetic. */
const WAL_MAGIC = 0x377f0682
const WAL_FORMAT_VERSION = 3007000

export interface WalFrame {
  /** 1-based page number. */
  pageNumber: number
  /** Byte offset of this frame's page payload inside the WAL file. */
  offset: number
}

export interface WalSnapshot {
  /** Newest committed frame per page. */
  frames: Map<number, WalFrame>
  /** Database size in pages at that commit. */
  dbSizePages: number
  /** `salt1:salt2` of the WAL header — changes whenever the WAL is reset after a checkpoint. */
  salt: string
}

/**
 * SQLite's WAL checksum: a two-word running sum over 8-byte blocks, seeded with the previous frame's
 * checksum. `data.length` must be a multiple of 8.
 */
export function walChecksum(data: Buffer, bigEndian: boolean, seed0: number, seed1: number): [number, number] {
  let s0 = seed0
  let s1 = seed1
  for (let offset = 0; offset + 8 <= data.length; offset += 8) {
    const a = bigEndian ? data.readUInt32BE(offset) : data.readUInt32LE(offset)
    const b = bigEndian ? data.readUInt32BE(offset + 4) : data.readUInt32LE(offset + 4)
    s0 = (s0 + a + s1) >>> 0
    s1 = (s1 + b + s0) >>> 0
  }
  return [s0, s1]
}

/**
 * Parse `walPath` and return the committed frames, or null when there is no usable WAL (missing,
 * empty, foreign page size, corrupt header, or no complete commit yet).
 */
export function readWalSnapshot(walPath: string, pageSize: number): WalSnapshot | null {
  let size: number
  try {
    size = statSync(walPath).size
  } catch {
    return null
  }
  const frameSize = WAL_FRAME_HEADER_SIZE + pageSize
  if (size < WAL_HEADER_SIZE + frameSize) return null

  const fd = openSync(walPath, 'r')
  try {
    const header = Buffer.alloc(WAL_HEADER_SIZE)
    if (readSync(fd, header, 0, WAL_HEADER_SIZE, 0) !== WAL_HEADER_SIZE) return null
    const magic = header.readUInt32BE(0)
    if ((magic & 0xfffffffe) >>> 0 !== WAL_MAGIC) return null
    if (header.readUInt32BE(4) !== WAL_FORMAT_VERSION) return null
    if (header.readUInt32BE(8) !== pageSize) return null
    const bigEndian = (magic & 1) === 1
    const [headerSum0, headerSum1] = walChecksum(header.subarray(0, 24), bigEndian, 0, 0)
    if (headerSum0 !== header.readUInt32BE(24) || headerSum1 !== header.readUInt32BE(28)) return null
    const salt = header.subarray(16, 24)

    const frame = Buffer.alloc(frameSize)
    const pending = new Map<number, WalFrame>()
    const frames = new Map<number, WalFrame>()
    let dbSizePages = 0
    let running0 = headerSum0
    let running1 = headerSum1
    for (let at = WAL_HEADER_SIZE; at + frameSize <= size; at += frameSize) {
      if (readSync(fd, frame, 0, frameSize, at) !== frameSize) break
      if (!frame.subarray(8, 16).equals(salt)) break
      const [sum0, sum1] = walChecksum(
        frame.subarray(WAL_FRAME_HEADER_SIZE),
        bigEndian,
        ...walChecksum(frame.subarray(0, 8), bigEndian, running0, running1),
      )
      if (sum0 !== frame.readUInt32BE(16) || sum1 !== frame.readUInt32BE(20)) break
      running0 = sum0
      running1 = sum1
      const pageNumber = frame.readUInt32BE(0)
      if (pageNumber < 1) break
      pending.set(pageNumber, { pageNumber, offset: at + WAL_FRAME_HEADER_SIZE })
      const committedSize = frame.readUInt32BE(4)
      if (committedSize > 0) {
        for (const [page, entry] of pending) frames.set(page, entry)
        pending.clear()
        dbSizePages = committedSize
      }
    }
    if (dbSizePages === 0) return null
    return { frames, dbSizePages, salt: salt.toString('hex') }
  } finally {
    closeSync(fd)
  }
}
