import { createDecipheriv, createHash, pbkdf2Sync } from 'crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import type { OpenWcdbParam, OpenWcdbQueryResult } from './openWcdbBridge'

const PAGE_SIZE = 4096
const SALT_SIZE = 16
const RESERVED_SIZE = 80
const WAL_HEADER_SIZE = 32
const WAL_FRAME_HEADER_SIZE = 24
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary')

type CacheEntry = {
  dbMtimeMs: number
  walMtimeMs: number
  keyHash: string
  cachePath: string
  /** 仅运行时使用；短时间的一组查询共享同一个数据库快照。 */
  preparedAt?: number
}

const PREPARED_SNAPSHOT_TTL_MS = 1_000

function normalizeInteger(value: bigint): number | string {
  if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value)
  }
  return value.toString()
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([name, value]) => {
    if (typeof value === 'bigint') return [name, normalizeInteger(value)]
    if (Buffer.isBuffer(value)) return [name, value.toString('hex')]
    return [name, value]
  }))
}

function decryptCbc(key: Buffer, iv: Buffer, encrypted: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

function decryptPage(page: Buffer, key: Buffer, firstMainPage: boolean): Buffer {
  if (page.length !== PAGE_SIZE) throw new Error(`加密页长度应为 ${PAGE_SIZE} 字节`)
  const ivOffset = PAGE_SIZE - RESERVED_SIZE
  const cipherOffset = firstMainPage ? SALT_SIZE : 0
  const plain = decryptCbc(key, page.subarray(ivOffset, ivOffset + 16), page.subarray(cipherOffset, ivOffset))
  const output = Buffer.alloc(PAGE_SIZE)
  if (firstMainPage) SQLITE_HEADER.copy(output, 0)
  plain.copy(output, cipherOffset)
  return output
}

function looksLikeSqliteFirstPage(page: Buffer): boolean {
  return (
    page.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER) &&
    page[16] === 0x10 && page[17] === 0x00 &&
    (page[18] === 1 || page[18] === 2) &&
    (page[19] === 1 || page[19] === 2) &&
    page[20] === RESERVED_SIZE &&
    page[21] === 0x40 && page[22] === 0x20 && page[23] === 0x20
  )
}

function readFirstPage(dbPath: string): Buffer {
  const fd = openSync(dbPath, 'r')
  try {
    const page = Buffer.alloc(PAGE_SIZE)
    const read = readSync(fd, page, 0, page.length, 0)
    if (read !== PAGE_SIZE) throw new Error(`数据库首页不足 ${PAGE_SIZE} 字节`)
    return page
  } finally {
    closeSync(fd)
  }
}

function isPlaintextDatabase(dbPath: string): boolean {
  return readFirstPage(dbPath).subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)
}

/**
 * The memory scanner can return either WCDB's derived key record or the raw
 * account key. Try the supplied bytes first, then SQLCipher 4 PBKDF2-SHA512.
 */
function resolveDatabaseKey(dbPath: string, hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) throw new Error('数据库密钥必须是 64 位十六进制字符串')
  const candidate = Buffer.from(hexKey, 'hex')
  const firstPage = readFirstPage(dbPath)
  if (firstPage.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) return candidate

  const direct = decryptPage(firstPage, candidate, true)
  if (looksLikeSqliteFirstPage(direct)) return candidate

  const derived = pbkdf2Sync(candidate, firstPage.subarray(0, SALT_SIZE), 256_000, 32, 'sha512')
  const derivedPage = decryptPage(firstPage, derived, true)
  if (looksLikeSqliteFirstPage(derivedPage)) return derived
  throw new Error('数据库密钥与加密首页不匹配')
}

function decryptDatabase(sourcePath: string, targetPath: string, key: Buffer): void {
  const sourceFd = openSync(sourcePath, 'r')
  const temporaryPath = `${targetPath}.tmp-${process.pid}`
  const targetFd = openSync(temporaryPath, 'w')
  try {
    const fileSize = statSync(sourcePath).size
    if (fileSize <= 0) throw new Error(`数据库文件为空: ${sourcePath}`)
    const page = Buffer.alloc(PAGE_SIZE)
    const pageCount = Math.ceil(fileSize / PAGE_SIZE)
    for (let index = 0; index < pageCount; index += 1) {
      page.fill(0)
      const offset = index * PAGE_SIZE
      const expected = Math.min(PAGE_SIZE, fileSize - offset)
      const read = readSync(sourceFd, page, 0, expected, offset)
      if (read !== expected) throw new Error(`读取数据库第 ${index + 1} 页失败`)
      const decrypted = decryptPage(page, key, index === 0)
      writeSync(targetFd, decrypted, 0, decrypted.length, offset)
    }
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }) } catch { /* best effort */ }
    throw error
  } finally {
    closeSync(sourceFd)
    closeSync(targetFd)
  }
  removeSqliteSidecars(targetPath)
  rmSync(targetPath, { force: true })
  renameSync(temporaryPath, targetPath)
}

function removeSqliteSidecars(dbPath: string): void {
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
}

function copyDatabase(sourcePath: string, targetPath: string): void {
  const temporaryPath = `${targetPath}.tmp-${process.pid}`
  copyFileSync(sourcePath, temporaryPath)
  removeSqliteSidecars(targetPath)
  rmSync(targetPath, { force: true })
  renameSync(temporaryPath, targetPath)
}

function applyWal(walPath: string, targetPath: string, key: Buffer, encrypted = true): void {
  if (!existsSync(walPath) || statSync(walPath).size <= WAL_HEADER_SIZE) return
  const walFd = openSync(walPath, 'r')
  const targetFd = openSync(targetPath, 'r+')
  try {
    const header = Buffer.alloc(WAL_HEADER_SIZE)
    if (readSync(walFd, header, 0, header.length, 0) !== header.length) return
    const salt1 = header.readUInt32BE(16)
    const salt2 = header.readUInt32BE(20)
    const frameHeader = Buffer.alloc(WAL_FRAME_HEADER_SIZE)
    const page = Buffer.alloc(PAGE_SIZE)
    const frameSize = WAL_FRAME_HEADER_SIZE + PAGE_SIZE
    const fileSize = statSync(walPath).size
    for (let offset = WAL_HEADER_SIZE; offset + frameSize <= fileSize; offset += frameSize) {
      if (readSync(walFd, frameHeader, 0, frameHeader.length, offset) !== frameHeader.length) break
      const pageNumber = frameHeader.readUInt32BE(0)
      const commitPageCount = frameHeader.readUInt32BE(4)
      if (!pageNumber || pageNumber > 1_000_000) continue
      if (frameHeader.readUInt32BE(8) !== salt1 || frameHeader.readUInt32BE(12) !== salt2) continue
      if (readSync(walFd, page, 0, page.length, offset + WAL_FRAME_HEADER_SIZE) !== page.length) break
      const decrypted = encrypted ? decryptPage(page, key, false) : Buffer.from(page)
      writeSync(targetFd, decrypted, 0, decrypted.length, (pageNumber - 1) * PAGE_SIZE)
      if (commitPageCount > 0) ftruncateSync(targetFd, commitPageCount * PAGE_SIZE)
    }
  } finally {
    closeSync(walFd)
    closeSync(targetFd)
  }
}

/** Pure TypeScript/Node fallback based on the SQLCipher 4 page format used by WeChat 4.x. */
export class SourceWcdbBridge {
  private cacheDir = ''
  private metaPath = ''
  private cache = new Map<string, CacheEntry>()
  private resolvedKeys = new Map<string, Buffer>()
  private rejectedKeys = new Set<string>()

  initialize(userDataPath: string): { success: boolean; error?: string } {
    try {
      const fallbackRoot = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'aiwc')
      this.cacheDir = join(userDataPath.trim() || fallbackRoot, 'wcdb-source-cache')
      this.metaPath = join(this.cacheDir, 'metadata.json')
      mkdirSync(this.cacheDir, { recursive: true })
      if (existsSync(this.metaPath)) {
        const saved = JSON.parse(readFileSync(this.metaPath, 'utf8')) as Record<string, CacheEntry>
        this.cache = new Map(Object.entries(saved))
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, error: `初始化源码数据库后端失败: ${error?.message || String(error)}` }
    }
  }

  canOpen(dbPath: string, hexKey?: string): boolean {
    try {
      if (!hexKey || !existsSync(dbPath)) return false
      this.resolveKey(dbPath, hexKey)
      return true
    } catch {
      return false
    }
  }

  execQuery(dbPath: string, sql: string, hexKey?: string): OpenWcdbQueryResult {
    return this.execQueryWithParams(dbPath, sql, [], hexKey)
  }

  execQueryWithParams(dbPath: string, sql: string, params: OpenWcdbParam[], hexKey?: string): OpenWcdbQueryResult {
    if (!hexKey) return { success: false, error: '源码数据库后端缺少解密密钥' }
    if (!dbPath || !existsSync(dbPath)) return { success: false, error: `数据库不存在: ${dbPath}` }
    if (!sql.trim()) return { success: false, error: 'SQL 不能为空' }
    try {
      const cachePath = this.prepareDatabase(dbPath, hexKey)
      const database = new Database(cachePath, { readonly: true, fileMustExist: true })
      try {
        database.defaultSafeIntegers(true)
        database.pragma('query_only = ON')
        const statement = database.prepare(sql)
        const rows = statement.reader ? statement.all(...params) : []
        return { success: true, rows: (rows as Array<Record<string, unknown>>).map(normalizeRow) }
      } finally {
        database.close()
      }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  }

  private prepareDatabase(dbPath: string, hexKey: string): string {
    const identity = createHash('sha256').update(dbPath.toLowerCase()).digest('hex')
    const keyHash = createHash('sha256').update(hexKey.toLowerCase()).digest('hex')
    const cachePath = join(this.cacheDir, `${identity}.db`)
    const cached = this.cache.get(identity)
    if (
      cached && cached.keyHash === keyHash && existsSync(cachePath) &&
      cached.preparedAt && Date.now() - cached.preparedAt < PREPARED_SNAPSHOT_TTL_MS
    ) {
      return cachePath
    }

    const sourceStat = statSync(dbPath)
    const walPath = `${dbPath}-wal`
    const walMtimeMs = existsSync(walPath) ? statSync(walPath).mtimeMs : 0
    const key = this.resolveKey(dbPath, hexKey)
    const encrypted = !isPlaintextDatabase(dbPath)
    let changed = false

    if (cached && cached.dbMtimeMs === sourceStat.mtimeMs && cached.keyHash === keyHash && existsSync(cachePath)) {
      if (cached.walMtimeMs !== walMtimeMs && existsSync(walPath)) {
        removeSqliteSidecars(cachePath)
        applyWal(walPath, cachePath, key, encrypted)
        changed = true
      }
    } else {
      if (encrypted) decryptDatabase(dbPath, cachePath, key)
      else copyDatabase(dbPath, cachePath)
      if (existsSync(walPath)) applyWal(walPath, cachePath, key, encrypted)
      changed = true
    }

    this.cache.set(identity, { dbMtimeMs: sourceStat.mtimeMs, walMtimeMs, keyHash, cachePath, preparedAt: Date.now() })
    if (changed) {
      const persisted = Object.fromEntries(Array.from(this.cache.entries()).map(([key, value]) => {
        const { preparedAt: _preparedAt, ...entry } = value
        return [key, entry]
      }))
      writeFileSync(this.metaPath, JSON.stringify(persisted, null, 2), 'utf8')
    }
    return cachePath
  }

  private resolveKey(dbPath: string, hexKey: string): Buffer {
    const identity = `${dbPath.toLowerCase()}\0${hexKey.toLowerCase()}`
    const cached = this.resolvedKeys.get(identity)
    if (cached) return cached
    if (this.rejectedKeys.has(identity)) throw new Error('数据库密钥与加密首页不匹配')
    try {
      const resolved = resolveDatabaseKey(dbPath, hexKey)
      this.resolvedKeys.set(identity, resolved)
      return resolved
    } catch (error) {
      this.rejectedKeys.add(identity)
      throw error
    }
  }

  dispose(): void {
    // Queries use short-lived read-only SQLite handles; there is nothing to unload.
    this.resolvedKeys.clear()
    this.rejectedKeys.clear()
  }
}
