/**
 * A decrypted, read-only mirror of one SQLCipher database, kept under the app cache so a stock SQLite
 * engine can read WeChat data where no WCDB build exists (Windows). The source is never written to.
 *
 * Refreshes stay cheap on a live database:
 *  - the main file is re-read only when its size/mtime changed, and then only pages whose IV moved
 *    are decrypted again (the copy keeps each page's reserved tail, so the IVs are already there —
 *    including across restarts);
 *  - WAL frames are overlaid on top and re-applied only when new frames arrive. Pages taken from the
 *    WAL get a zeroed tail, which makes the next main pass restore them after a checkpoint.
 *
 * A database that crashed with a hot rollback journal is copied as committed; WCDB runs in WAL mode,
 * so that case does not occur in practice.
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { SQLCIPHER_PAGE_SIZE } from '../key/sqlcipherPage'
import type { WcdbLogger } from './bridge'
import { decryptPageInto, PAGE_BODY_END } from './sqlcipherCodec'
import { readWalSnapshot, type WalSnapshot } from './sqliteWal'

const PAGE = SQLCIPHER_PAGE_SIZE
/** Pages per read/write batch (512 KiB). */
const PAGES_PER_CHUNK = 128
/** Bytes of each page IV remembered to detect rewritten pages; IVs are random, so 8 is plenty. */
const IV_PREFIX = 8
const DEFAULT_REFRESH_INTERVAL_MS = 100
const COPY_DIR_NAME = 'wcdb-plain'

export interface DecryptedCopyOptions {
  /** The encrypted source database. */
  dbPath: string
  /** 32-byte AES key from `resolvePageCipher`. */
  key: Buffer
  /** Hex of the database's KDF salt — part of the copy's name, so a replaced database never reuses it. */
  saltHex: string
  /** Root for the copies (the app cache directory). */
  cacheDir: string
  refreshIntervalMs?: number
  logger?: WcdbLogger
}

function fileStamp(path: string): string {
  try {
    const stat = statSync(path)
    return `${stat.size}:${stat.mtimeMs}`
  } catch {
    return ''
  }
}

/** `<sha12 of source path>-<stem>-<salt>.db`; the stem is only there to keep the cache readable. */
function copyFileName(dbPath: string, saltHex: string): { name: string; prefix: string } {
  const prefix = `${createHash('sha256').update(dbPath).digest('hex').slice(0, 12)}-`
  const stem = basename(dbPath)
    .replace(/\.db$/i, '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 24)
  return { name: `${prefix}${stem}-${saltHex}.db`, prefix }
}

export class DecryptedCopy {
  /** Path of the plaintext copy; safe to hand to any SQLite engine. */
  readonly path: string
  private readonly dbPath: string
  private readonly walPath: string
  private readonly key: Buffer
  private readonly refreshIntervalMs: number
  private readonly logger?: WcdbLogger
  /** IV prefixes of the pages currently in the copy, page N at (N-1) * IV_PREFIX. */
  private ivs = Buffer.alloc(0)
  /** Frame offset per page already overlaid from the current WAL generation. */
  private readonly walApplied = new Map<number, number>()
  private pages = 0
  private mainPages = 0
  private mainStamp = ''
  private walStamp = ''
  private walSalt = ''
  private checkedAt = 0
  private ready = false

  constructor(opts: DecryptedCopyOptions) {
    this.dbPath = opts.dbPath
    this.walPath = `${opts.dbPath}-wal`
    this.key = opts.key
    this.refreshIntervalMs = opts.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
    this.logger = opts.logger
    const dir = join(opts.cacheDir, COPY_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    const { name, prefix } = copyFileName(opts.dbPath, opts.saltHex)
    this.path = join(dir, name)
    this.removeStaleCopies(dir, prefix, name)
  }

  /**
   * Bring the copy up to date with the source. Returns true when bytes changed, which tells callers
   * to reopen their SQLite connection rather than serve pages it has already cached.
   */
  refresh(force = false): boolean {
    const now = Date.now()
    if (!force && this.ready && now - this.checkedAt < this.refreshIntervalMs) return false
    this.checkedAt = now
    const mainStamp = fileStamp(this.dbPath)
    const walStamp = fileStamp(this.walPath)
    if (this.ready && mainStamp === this.mainStamp && walStamp === this.walStamp) return false

    const snapshot = walStamp ? readWalSnapshot(this.walPath, PAGE) : null
    const walReset = (snapshot?.salt ?? '') !== this.walSalt
    if (walReset) this.walApplied.clear()
    const existed = existsSync(this.path)
    const fd = openSync(this.path, existed ? 'r+' : 'w+')
    let changed = false
    try {
      if (!this.ready && existed) this.seedFromCopy(fd)
      if (!this.ready || walReset || mainStamp !== this.mainStamp) changed = this.copyMainPages(fd) || changed
      if (snapshot) changed = this.applyWal(fd, snapshot) || changed
      changed = this.resize(fd, snapshot?.dbSizePages ?? this.mainPages) || changed
    } finally {
      closeSync(fd)
    }
    this.mainStamp = mainStamp
    this.walStamp = walStamp
    this.walSalt = snapshot?.salt ?? ''
    this.ready = true
    return changed
  }

  /** Delete the copy (the source is untouched). */
  remove(): void {
    this.ready = false
    this.ivs = Buffer.alloc(0)
    this.walApplied.clear()
    this.pages = 0
    try {
      rmSync(this.path, { force: true })
    } catch (error) {
      this.logger?.('debug', '[wcdb] could not remove decrypted copy', error)
    }
  }

  // ----------------------------------------------------------------------------------------------

  /** Older copies of the same source (different salt) can never be reused. */
  private removeStaleCopies(dir: string, prefix: string, keep: string): void {
    try {
      for (const name of readdirSync(dir)) {
        if (!name.startsWith(prefix) || name === keep) continue
        rmSync(join(dir, name), { force: true })
      }
    } catch (error) {
      this.logger?.('debug', '[wcdb] could not sweep stale decrypted copies', error)
    }
  }

  /** Recover the IV index from an existing copy so a restart does not re-decrypt everything. */
  private seedFromCopy(fd: number): void {
    const pages = Math.floor(fstatSync(fd).size / PAGE)
    if (pages === 0) return
    this.ensureIvs(pages)
    const chunk = Buffer.allocUnsafe(Math.min(pages, PAGES_PER_CHUNK) * PAGE)
    for (let first = 1; first <= pages; first += PAGES_PER_CHUNK) {
      const count = Math.min(PAGES_PER_CHUNK, pages - first + 1)
      const read = readSync(fd, chunk, 0, count * PAGE, (first - 1) * PAGE)
      for (let slot = 0; slot < Math.floor(read / PAGE); slot += 1) {
        const from = slot * PAGE + PAGE_BODY_END
        chunk.copy(this.ivs, (first - 1 + slot) * IV_PREFIX, from, from + IV_PREFIX)
      }
    }
    this.pages = pages
    this.mainPages = pages
  }

  private copyMainPages(target: number): boolean {
    const src = openSync(this.dbPath, 'r')
    try {
      const pages = Math.floor(fstatSync(src).size / PAGE)
      this.ensureIvs(pages)
      const input = Buffer.allocUnsafe(PAGES_PER_CHUNK * PAGE)
      const output = Buffer.allocUnsafe(PAGES_PER_CHUNK * PAGE)
      let changed = false
      for (let first = 1; first <= pages; first += PAGES_PER_CHUNK) {
        const count = Math.min(PAGES_PER_CHUNK, pages - first + 1)
        const read = readSync(src, input, 0, count * PAGE, (first - 1) * PAGE)
        changed = this.copyChunk(target, input, output, first, Math.floor(read / PAGE)) || changed
      }
      this.mainPages = pages
      this.pages = Math.max(this.pages, pages)
      return changed
    } finally {
      closeSync(src)
    }
  }

  /** Decrypt the changed pages of one chunk and write them back as contiguous runs. */
  private copyChunk(target: number, input: Buffer, output: Buffer, firstPage: number, available: number): boolean {
    let changed = false
    let runStart = -1
    const flush = (endSlot: number): void => {
      if (runStart < 0) return
      const length = (endSlot - runStart) * PAGE
      writeSync(target, output, runStart * PAGE, length, (firstPage - 1 + runStart) * PAGE)
      runStart = -1
    }
    for (let slot = 0; slot < available; slot += 1) {
      const pageNumber = firstPage + slot
      const page = input.subarray(slot * PAGE, (slot + 1) * PAGE)
      const iv = page.subarray(PAGE_BODY_END, PAGE_BODY_END + IV_PREFIX)
      if (pageNumber <= this.pages && this.ivMatches(pageNumber, iv)) {
        flush(slot)
        continue
      }
      if (!decryptPageInto(page, this.key, pageNumber, output, slot * PAGE)) {
        flush(slot)
        throw new Error(`数据库页解密失败（第 ${pageNumber} 页）`)
      }
      iv.copy(this.ivs, (pageNumber - 1) * IV_PREFIX)
      // The main file is older than any WAL frame for this page, so that frame must be re-applied.
      this.walApplied.delete(pageNumber)
      if (runStart < 0) runStart = slot
      changed = true
    }
    flush(available)
    return changed
  }

  private applyWal(target: number, snapshot: WalSnapshot): boolean {
    this.ensureIvs(snapshot.dbSizePages)
    const fd = openSync(this.walPath, 'r')
    const input = Buffer.allocUnsafe(PAGE)
    const output = Buffer.allocUnsafe(PAGE)
    let changed = false
    try {
      for (const frame of snapshot.frames.values()) {
        const { pageNumber, offset } = frame
        if (pageNumber > snapshot.dbSizePages || this.walApplied.get(pageNumber) === offset) continue
        if (readSync(fd, input, 0, PAGE, offset) !== PAGE) break
        if (!decryptPageInto(input, this.key, pageNumber, output, 0)) {
          throw new Error(`数据库页解密失败（第 ${pageNumber} 页）`)
        }
        // A zeroed tail marks the page as "came from the WAL", so the next main pass revisits it.
        output.fill(0, PAGE_BODY_END)
        writeSync(target, output, 0, PAGE, (pageNumber - 1) * PAGE)
        this.ivs.fill(0, (pageNumber - 1) * IV_PREFIX, pageNumber * IV_PREFIX)
        this.walApplied.set(pageNumber, offset)
        this.pages = Math.max(this.pages, pageNumber)
        changed = true
      }
    } finally {
      closeSync(fd)
    }
    return changed
  }

  /** Cut the copy back to the committed page count (a WAL commit may have shrunk the database). */
  private resize(fd: number, pages: number): boolean {
    const wanted = pages * PAGE
    const size = fstatSync(fd).size
    let changed = false
    if (wanted > 0 && size > wanted) {
      ftruncateSync(fd, wanted)
      changed = true
    } else if (wanted > size) {
      this.logger?.('warn', '[wcdb] decrypted copy is shorter than the committed size', { wanted, size })
    }
    this.pages = Math.floor(fstatSync(fd).size / PAGE)
    return changed
  }

  private ensureIvs(pages: number): void {
    const wanted = pages * IV_PREFIX
    if (this.ivs.length >= wanted) return
    const grown = Buffer.alloc(wanted)
    this.ivs.copy(grown)
    this.ivs = grown
  }

  /** A zeroed entry means "unknown / came from the WAL" and never matches. */
  private ivMatches(pageNumber: number, iv: Buffer): boolean {
    const at = (pageNumber - 1) * IV_PREFIX
    if (at + IV_PREFIX > this.ivs.length) return false
    let empty = true
    for (let i = at; i < at + IV_PREFIX; i += 1) {
      if (this.ivs[i] !== 0) {
        empty = false
        break
      }
    }
    return !empty && this.ivs.compare(iv, 0, IV_PREFIX, at, at + IV_PREFIX) === 0
  }
}
