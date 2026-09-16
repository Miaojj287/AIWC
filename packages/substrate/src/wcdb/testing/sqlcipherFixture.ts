/**
 * Test-only builders for SQLCipher 4 / SQLite WAL byte layouts, so the decoder can be exercised
 * byte-exactly without a real WeChat database. Never imported from production code.
 */
import { createCipheriv } from 'node:crypto'
import { SQLCIPHER_PAGE_SIZE, SQLCIPHER_RESERVED_SIZE, SQLCIPHER_SALT_SIZE } from '../../key/sqlcipherPage'
import { PAGE_BODY_END, PAGE_IV_SIZE, SQLITE_MAGIC } from '../sqlcipherCodec'
import { walChecksum } from '../sqliteWal'

export const FIXTURE_SALT = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')

/**
 * A recognizable plaintext page: page 1 carries the SQLite header fields the decoder checks, every
 * page is filled with `marker` and ends with 80 bytes standing in for IV + HMAC.
 */
export function plaintextPage(pageNumber: number, marker: number): Buffer {
  const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE, marker)
  if (pageNumber === 1) {
    SQLITE_MAGIC.copy(page, 0)
    page.writeUInt16BE(SQLCIPHER_PAGE_SIZE, 16)
    page[18] = 2 // write version: WAL, which the decoder must rewrite to 1
    page[19] = 2
    page[20] = SQLCIPHER_RESERVED_SIZE
    page[21] = 0x40
    page[22] = 0x20
    page[23] = 0x20
  }
  return page
}

/**
 * The bytes `decryptPageInto` must produce: the plaintext body, the ciphertext's reserved tail
 * (IV + HMAC, which SQLite ignores but refreshes rely on), magic restored and journal mode forced to 1.
 */
export function expectedPlainPage(plain: Buffer, pageNumber: number, encrypted: Buffer): Buffer {
  const out = Buffer.from(plain)
  encrypted.subarray(PAGE_BODY_END).copy(out, PAGE_BODY_END)
  if (pageNumber === 1) {
    SQLITE_MAGIC.copy(out, 0)
    out[18] = 1
    out[19] = 1
  }
  return out
}

/** Encrypt one page the way SQLCipher 4 does: salt prefix on page 1, IV + HMAC in the reserved tail. */
export function encryptPage(plain: Buffer, key: Buffer, pageNumber: number, iv: Buffer): Buffer {
  const bodyStart = pageNumber === 1 ? SQLCIPHER_SALT_SIZE : 0
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  const body = Buffer.concat([cipher.update(plain.subarray(bodyStart, PAGE_BODY_END)), cipher.final()])
  const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
  if (pageNumber === 1) FIXTURE_SALT.copy(page, 0)
  body.copy(page, bodyStart)
  iv.copy(page, PAGE_BODY_END)
  // HMAC stand-in: read-only access never verifies it, but it must round-trip into the copy.
  page.fill(0xab, PAGE_BODY_END + PAGE_IV_SIZE)
  return page
}

/** Deterministic per-page IV so tests can say "this page was rewritten". */
export function fixtureIv(seed: number): Buffer {
  return Buffer.alloc(PAGE_IV_SIZE, seed)
}

export interface FixtureFrame {
  pageNumber: number
  /** 0 for a non-commit frame, otherwise the database size in pages after this commit. */
  dbSize: number
  /** The encrypted page payload. */
  payload: Buffer
}

export interface WalFixtureOptions {
  frames: FixtureFrame[]
  salt?: Buffer
  pageSize?: number
  bigEndian?: boolean
  /** Corrupt the checksum of the frame at this index. */
  breakFrameAt?: number
  /** Use a different salt from this frame onwards (as a stale, pre-reset frame would have). */
  foreignSaltAt?: number
}

/** A complete WAL file with valid header and frame checksums. */
export function buildWal(opts: WalFixtureOptions): Buffer {
  const pageSize = opts.pageSize ?? SQLCIPHER_PAGE_SIZE
  const salt = opts.salt ?? Buffer.from('a1a2a3a4b1b2b3b4', 'hex')
  const bigEndian = opts.bigEndian ?? true
  const header = Buffer.alloc(32)
  header.writeUInt32BE(bigEndian ? 0x377f0683 : 0x377f0682, 0)
  header.writeUInt32BE(3007000, 4)
  header.writeUInt32BE(pageSize, 8)
  header.writeUInt32BE(1, 12)
  salt.copy(header, 16)
  const [h0, h1] = walChecksum(header.subarray(0, 24), bigEndian, 0, 0)
  header.writeUInt32BE(h0, 24)
  header.writeUInt32BE(h1, 28)

  const chunks: Buffer[] = [header]
  let running0 = h0
  let running1 = h1
  opts.frames.forEach((frame, index) => {
    const frameHeader = Buffer.alloc(24)
    frameHeader.writeUInt32BE(frame.pageNumber, 0)
    frameHeader.writeUInt32BE(frame.dbSize, 4)
    const frameSalt = opts.foreignSaltAt !== undefined && index >= opts.foreignSaltAt ? Buffer.alloc(8, 0x99) : salt
    frameSalt.copy(frameHeader, 8)
    const [seed0, seed1] = walChecksum(frameHeader.subarray(0, 8), bigEndian, running0, running1)
    const [sum0, sum1] = walChecksum(frame.payload, bigEndian, seed0, seed1)
    frameHeader.writeUInt32BE(index === opts.breakFrameAt ? (sum0 ^ 0xffff) >>> 0 : sum0, 16)
    frameHeader.writeUInt32BE(sum1, 20)
    running0 = sum0
    running1 = sum1
    chunks.push(frameHeader, frame.payload)
  })
  return Buffer.concat(chunks)
}
