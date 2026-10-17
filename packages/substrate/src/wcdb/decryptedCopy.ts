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
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
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
import { decryptPageInto, pageHmacMatches, PAGE_BODY_END, type PageCipher } from './sqlcipherCodec'
import { readWalSnapshot, walPageCeiling, type WalSnapshot } from './sqliteWal'
import { authenticatedMainPageCount } from './sqlitePageExtent'

const PAGE = SQLCIPHER_PAGE_SIZE
/** Pages per read/write batch (512 KiB). */
const PAGES_PER_CHUNK = 128
/** Bytes of each page IV remembered to detect rewritten pages; IVs are random, so 8 is plenty. */
const IV_PREFIX = 8
const DEFAULT_REFRESH_INTERVAL_MS = 100
/**
 * Folder under the cache directory that holds the plaintext copies. Exported because the main process
 * has to keep it out of the agent's reach, and a second spelling of the name would silently drift.
 */
export const DECRYPTED_COPY_DIR_NAME = 'wcdb-plain'
/** Every plaintext copy of a WeChat database lives here and nowhere else. */
export function decryptedCopyDir(cacheDir: string): string {
  return join(cacheDir, DECRYPTED_COPY_DIR_NAME)
}
/** The copy is the account's chat history in the clear, so it is owner-only like a private key. */
const COPY_DIR_MODE = 0o700
const COPY_FILE_MODE = 0o600

export interface DecryptedCopyOptions {
  /** The encrypted source database. */
  dbPath: string
  /**
   * Page keys from `resolvePageCipher`. Its `saltHex` names the copy, so a replaced database (new
   * salt) never reuses an older one.
   */
  cipher: PageCipher
  /** Root for the copies (the app cache directory). */
  cacheDir: string
  refreshIntervalMs?: number
  logger?: WcdbLogger
}

/**
 * Keep the plaintext out of reach of other accounts on the machine. A mode passed to mkdir/open only
 * applies to what this process creates, so an existing directory or copy — from an earlier build, or
 * from a cache directory the user picked — is tightened as well. Windows has no POSIX modes: the
 * cache inherits the user profile's ACL there, which is why this is a no-op on win32.
 */
function restrict(target: string | number, mode: number, logger?: WcdbLogger): void {
  if (process.platform === 'win32') return
  try {
    if (typeof target === 'number') fchmodSync(target, mode)
    else chmodSync(target, mode)
  } catch (error) {
    logger?.('debug', '[wcdb] could not restrict access to the decrypted copy', error)
  }
}

interface FileStamp {
  size: number
  /** Empty when the file is not there; otherwise it changes whenever the file was written. */
  stamp: string
}

function fileStamp(path: string): FileStamp {
  try {
    const stat = statSync(path)
    return { size: stat.size, stamp: `${stat.size}:${stat.mtimeMs}` }
  } catch {
    return { size: 0, stamp: '' }
  }
}

/**
 * `<sha12 of source path>-<stem>-<salt>.db`; the stem is only there to keep the cache readable.
 * The salt comes out of the database file itself, so it is checked before it becomes a path segment
 * (a 32-hex string can hold no separator, but the type alone does not say so).
 */
function copyFileName(dbPath: string, saltHex: string): { name: string; prefix: string } {
  if (!/^[0-9a-f]{32}$/.test(saltHex)) throw new Error(`数据库盐值非法: ${saltHex.slice(0, 40)}`)
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
  private readonly cipher: PageCipher
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
    this.cipher = opts.cipher
    this.refreshIntervalMs = opts.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
    this.logger = opts.logger
    const { name, prefix } = copyFileName(opts.dbPath, opts.cipher.saltHex)
    const dir = decryptedCopyDir(opts.cacheDir)
    mkdirSync(dir, { recursive: true, mode: COPY_DIR_MODE })
    restrict(dir, COPY_DIR_MODE, this.logger)
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
    const main = fileStamp(this.dbPath)
    const wal = fileStamp(this.walPath)
    if (this.ready && main.stamp === this.mainStamp && wal.stamp === this.walStamp) return false

    const snapshot = wal.stamp ? readWalSnapshot(this.walPath, PAGE, walPageCeiling(main.size, wal.size, PAGE)) : null
    const walReset = (snapshot?.salt ?? '') !== this.walSalt
    if (walReset) this.walApplied.clear()
    const existed = existsSync(this.path)
    const fd = openSync(this.path, existed ? 'r+' : 'w+', COPY_FILE_MODE)
    let changed = false
    try {
      restrict(fd, COPY_FILE_MODE, this.logger)
      if (!this.ready && existed) this.seedFromCopy(fd)
      if (!this.ready || walReset || main.stamp !== this.mainStamp) changed = this.copyMainPages(fd) || changed
      if (snapshot) changed = this.applyWal(fd, snapshot) || changed
      changed = this.resize(fd, snapshot?.dbSizePages ?? this.mainPages) || changed
    } finally {
      closeSync(fd)
    }
    this.mainStamp = main.stamp
    this.walStamp = wal.stamp
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
    try {
      for (let first = 1; first <= pages; first += PAGES_PER_CHUNK) {
        const count = Math.min(PAGES_PER_CHUNK, pages - first + 1)
        const read = readSync(fd, chunk, 0, count * PAGE, (first - 1) * PAGE)
        for (let slot = 0; slot < Math.floor(read / PAGE); slot += 1) {
          const from = slot * PAGE + PAGE_BODY_END
          chunk.copy(this.ivs, (first - 1 + slot) * IV_PREFIX, from, from + IV_PREFIX)
        }
      }
    } finally {
      chunk.fill(0)
    }
    this.pages = pages
    this.mainPages = pages
  }

  private copyMainPages(target: number): boolean {
    const firstPage = Buffer.alloc(PAGE)
    const savedTail = Buffer.alloc(PAGE - PAGE_BODY_END)
    const input = Buffer.alloc(PAGES_PER_CHUNK * PAGE)
    const output = Buffer.alloc(PAGES_PER_CHUNK * PAGE)
    const src = openSync(this.dbPath, 'r')
    try {
      const physicalBytes = fstatSync(src).size
      if (physicalBytes === 0) {
        // An emptied source must not leave readable historical plaintext behind in our cache.
        this.mainPages = 0
        return false
      }
      if (readSync(src, firstPage, 0, PAGE, 0) !== PAGE) throw new Error('WECHAT_DATABASE_PAGE_EXTENT_INVALID')
      const pages = authenticatedMainPageCount(firstPage, this.cipher, physicalBytes)
      if (pages === undefined) throw new Error('WECHAT_DATABASE_PAGE_EXTENT_INVALID')
      // A logical shrink can rewrite the header with the same IV; its authenticated tail still changes.
      const forceHeader =
        readSync(target, savedTail, 0, savedTail.length, PAGE_BODY_END) !== savedTail.length ||
        !savedTail.equals(firstPage.subarray(PAGE_BODY_END))
      this.ensureIvs(pages)
      let changed = false
      for (let first = 1; first <= pages; first += PAGES_PER_CHUNK) {
        const count = Math.min(PAGES_PER_CHUNK, pages - first + 1)
        const read = readSync(src, input, 0, count * PAGE, (first - 1) * PAGE)
        if (read !== count * PAGE) throw new Error('WECHAT_DATABASE_PAGE_EXTENT_INVALID')
        changed = this.copyChunk(target, input, output, first, count, forceHeader) || changed
      }
      this.mainPages = pages
      this.pages = Math.max(this.pages, pages)
      return changed
    } finally {
      firstPage.fill(0)
      savedTail.fill(0)
      input.fill(0)
      output.fill(0)
      closeSync(src)
    }
  }

  /** Decrypt the changed pages of one chunk and write them back as contiguous runs. */
  private copyChunk(
    target: number,
    input: Buffer,
    output: Buffer,
    firstPage: number,
    available: number,
    forceHeader: boolean,
  ): boolean {
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
      if (this.cipher.hmacKey && !pageHmacMatches(this.cipher.hmacKey, page, pageNumber)) {
        flush(slot)
        throw new Error(`数据库页解密失败（第 ${pageNumber} 页）`)
      }
      if (pageNumber <= this.pages && !(forceHeader && pageNumber === 1) && this.ivMatches(pageNumber, iv)) {
        flush(slot)
        continue
      }
      if (!decryptPageInto(page, this.cipher, pageNumber, output, slot * PAGE)) {
        // Neither written nor remembered: refresh() leaves the source stamp alone when it throws, so
        // a page caught mid-write is read again instead of landing in the copy as garbage.
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
        // Throwing rather than stopping: refresh() records the WAL as applied only when it returns,
        // so giving up quietly here would leave the missing frames behind until the WAL changes again.
        if (readSync(fd, input, 0, PAGE, offset) !== PAGE) {
          throw new Error(`WAL 帧读取不完整（第 ${pageNumber} 页）`)
        }
        if (!decryptPageInto(input, this.cipher, pageNumber, output, 0)) {
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
      input.fill(0)
      output.fill(0)
      closeSync(fd)
    }
    return changed
  }

  /**
   * Cut the copy back to the committed page count: a WAL commit may have shrunk the database, and a
   * source WeChat truncated away has nothing left to serve — a copy longer than its source would keep
   * handing out chat history that no longer exists.
   */
  private resize(fd: number, pages: number): boolean {
    const wanted = pages * PAGE
    const size = fstatSync(fd).size
    let changed = false
    if (size > wanted) {
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
