/**
 * Windows read-only db-key scan. Requests only PROCESS_VM_READ | PROCESS_QUERY_INFORMATION; never
 * writes to or injects into WeChat. koffi is loaded lazily inside the scan function so importing this
 * module is side-effect free (and safe on macOS, where it is never called).
 *
 * Three paths, tried in this order:
 *   1. `Config.Cipher` — WeChat 4.1.13+ keeps the per-database key inside an XOR-obfuscated
 *      `com.Tencent.WCDB.Config.Cipher` blob. Walking the WCDB config node gives the key directly
 *      (already PBKDF2-derived → a 'direct' key), which is deterministic and works after login.
 *   2. raw UUIDv4 blocks — the transient in-memory account key (WeChat 4.1.x); needs PBKDF2.
 *   3. ASCII `x'<key><salt>'` record — legacy builds.
 * Pattern matching for (2)/(3) lives in memoryDbKeyPattern (fully tested); the Config.Cipher node
 * walk is ported from the reference AIWC_ORG implementation (THIRD_PARTY_NOTICES.md).
 */
import { createRequire } from 'node:module'
import { createDecipheriv } from 'node:crypto'
import { extractMemoryDbKeyCandidates, extractRawV4KeyCandidates, RAW_KEY_SIZE } from './memoryDbKeyPattern'
import { classifyKeyAgainstPage, deriveSqlcipherKey, readFirstPage, readEncryptedDbSalt, SQLCIPHER_PAGE_SIZE, decryptFirstPageBody, looksLikeSqliteHeaderBody } from './sqlcipherPage'

const requireNative = createRequire(import.meta.url)

const PROCESS_VM_READ = 0x0010
const PROCESS_QUERY_INFORMATION = 0x0400
const MEM_COMMIT = 0x1000
const MEM_PRIVATE = 0x20000
const PAGE_GUARD = 0x100
const PAGE_NOCACHE = 0x200
const PAGE_WRITECOMBINE = 0x400
const PAGE_READONLY = 0x02
const PAGE_READWRITE = 0x04
const PAGE_WRITECOPY = 0x08
const PAGE_EXECUTE_READ = 0x20
const PAGE_EXECUTE_READWRITE = 0x40
const PAGE_EXECUTE_WRITECOPY = 0x80
const MEMORY_BASIC_INFORMATION_X64_SIZE = 48
const MAX_USER_ADDRESS = 0x7fff_ffff_ffffn
const MAX_REGION_SIZE = 512 * 1024 * 1024
const CHUNK_SIZE = 2 * 1024 * 1024
const OVERLAP = 98
const MAX_RAW_CANDIDATES = 32
const MAX_MEMORY_HITS = 128
const IMAGE_KEY_OVERLAP_SIZE = 65
const MAX_IMAGE_REGION_SIZE = 100 * 1024 * 1024

// The Config.Cipher blob is stored XOR-masked against this fixed key window (WCDB build constant).
const CONFIG_CIPHER_NAME = Buffer.from('com.Tencent.WCDB.Config.Cipher', 'ascii')
const CONFIG_XOR_MASK = Buffer.from('d2c7442458020000004889442450488b450048844c2448488944254048584c24', 'hex')

export interface WindowsDbKeyScanResult {
  key: string | null
  opened: boolean
  dbOk: boolean
  bytes: number
  candidates: number
}

function isWritableReadable(protect: number): boolean {
  const base = protect & ~(PAGE_GUARD | PAGE_NOCACHE | PAGE_WRITECOMBINE)
  return base === PAGE_READWRITE || base === PAGE_WRITECOPY || base === PAGE_EXECUTE_READWRITE || base === PAGE_EXECUTE_WRITECOPY
}

function isReadable(protect: number): boolean {
  if (protect & PAGE_GUARD) return false
  const base = protect & ~(PAGE_GUARD | PAGE_NOCACHE | PAGE_WRITECOMBINE)
  return (
    base === PAGE_READONLY ||
    base === PAGE_READWRITE ||
    base === PAGE_WRITECOPY ||
    base === PAGE_EXECUTE_READ ||
    base === PAGE_EXECUTE_READWRITE ||
    base === PAGE_EXECUTE_WRITECOPY
  )
}

/** 'direct' Config.Cipher key: decrypts page 1 without PBKDF2. */
function verifyDirectKey(key: Buffer, page: Buffer): boolean {
  if (key.length !== RAW_KEY_SIZE) return false
  const body = decryptFirstPageBody(page, key)
  return !!body && looksLikeSqliteHeaderBody(body)
}

/** 'raw' key: decrypts after PBKDF2(key, salt). */
function verifyRawKey(key: Buffer, page: Buffer): boolean {
  if (key.length !== RAW_KEY_SIZE) return false
  const derived = deriveSqlcipherKey(key, page.subarray(0, 16))
  const body = decryptFirstPageBody(page, derived)
  return !!body && looksLikeSqliteHeaderBody(body)
}

/* -------------------------------------------------------------- image AES */

function isAsciiAlphaNumeric(value: number | undefined): boolean {
  if (value === undefined) return false
  return (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a)
}
function isPrintableAscii(value: number | undefined): boolean {
  if (value === undefined) return false
  return value >= 0x20 && value <= 0x7e
}
function imageHeaderMatches(plain: Buffer): boolean {
  return (
    (plain[0] === 0xff && plain[1] === 0xd8 && plain[2] === 0xff) ||
    plain.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    plain.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii')) ||
    plain.subarray(0, 4).equals(Buffer.from('wxgf', 'ascii')) ||
    plain.subarray(0, 3).equals(Buffer.from('GIF', 'ascii'))
  )
}

/** Validate the first encrypted V2 image block with an AES-128-ECB candidate. */
export function verifyWindowsImageAesKey(candidate: Buffer, ciphertext: Buffer): boolean {
  if (candidate.length < 16 || ciphertext.length !== 16) return false
  try {
    const decipher = createDecipheriv('aes-128-ecb', candidate.subarray(0, 16), null)
    decipher.setAutoPadding(false)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return imageHeaderMatches(plain)
  } catch {
    return false
  }
}

/**
 * Extract and verify image-key representations used by WeChat 4.x: a delimited 32-char alphanumeric
 * token (ASCII or UTF-16LE), or a bare printable 16-byte key. Structured matching keeps us from
 * attempting AES at every byte of ordinary text. Exported so the rules are testable off-Windows.
 */
export function findWindowsImageAesKey(data: Buffer, ciphertext: Buffer): { key: string | null; candidates: number } {
  const tested = new Set<string>()
  let candidates = 0
  const test = (candidate: Buffer): string | null => {
    const key = Buffer.from(candidate.subarray(0, 16))
    const identity = key.toString('hex')
    if (tested.has(identity)) return null
    tested.add(identity)
    candidates += 1
    return verifyWindowsImageAesKey(key, ciphertext) ? key.toString('ascii') : null
  }

  // The common representation is a delimited 32-character alphanumeric token.
  let index = 0
  while (index < data.length) {
    if (!isAsciiAlphaNumeric(data[index])) {
      index += 1
      continue
    }
    const start = index
    while (index < data.length && isAsciiAlphaNumeric(data[index])) index += 1
    if (index - start === 32) {
      const key = test(data.subarray(start, start + 32))
      if (key) return { key, candidates }
    }
  }

  // Some WeChat builds retain the same token as UTF-16LE.
  for (let start = 0; start + 64 <= data.length; start += 1) {
    let valid = true
    for (let offset = 0; offset < 64; offset += 2) {
      if (!isAsciiAlphaNumeric(data[start + offset]) || data[start + offset + 1] !== 0) {
        valid = false
        break
      }
    }
    if (!valid) continue
    const compact = Buffer.allocUnsafe(32)
    for (let offset = 0; offset < 32; offset += 1) compact[offset] = data[start + offset * 2] ?? 0
    const key = test(compact)
    if (key) return { key, candidates }
    start += 63
  }

  // Legacy builds can store an isolated printable 16-byte key without the 32-char wrapper.
  index = 0
  while (index < data.length) {
    if (!isPrintableAscii(data[index])) {
      index += 1
      continue
    }
    const start = index
    while (index < data.length && isPrintableAscii(data[index])) index += 1
    if (index - start === 16) {
      const key = test(data.subarray(start, start + 16))
      if (key) return { key, candidates }
    }
  }

  return { key: null, candidates }
}

/* --------------------------------------------------- Win32 memory access */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KernelFn = (...args: any[]) => any

interface Kernel32 {
  virtualQueryEx: KernelFn
  readProcessMemory: KernelFn
}

function loadKernel32(): { openProcess: KernelFn; virtualQueryEx: KernelFn; readProcessMemory: KernelFn; closeHandle: KernelFn } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let kernel32: any
  try {
    kernel32 = requireNative('koffi').load('kernel32.dll')
  } catch {
    return null
  }
  return {
    openProcess: kernel32.func('uintptr_t OpenProcess(uint32_t desiredAccess, int inheritHandle, uint32_t processId)'),
    virtualQueryEx: kernel32.func('size_t VirtualQueryEx(uintptr_t process, uintptr_t address, _Out_ uint8_t *info, size_t length)'),
    readProcessMemory: kernel32.func('int ReadProcessMemory(uintptr_t process, uintptr_t address, _Out_ uint8_t *buffer, size_t size, _Out_ size_t *bytesRead)'),
    closeHandle: kernel32.func('int CloseHandle(uintptr_t handle)'),
  }
}

function readRemote(k: Kernel32, handle: bigint, address: bigint, size: number): Buffer | null {
  if (address < 0x10000n || address >= MAX_USER_ADDRESS || size <= 0) return null
  const buffer = Buffer.allocUnsafe(size)
  const readBuf = Buffer.alloc(8)
  k.readProcessMemory(handle, address, buffer, size, readBuf)
  return readBuf.readBigUInt64LE(0) === BigInt(size) ? Buffer.from(buffer.subarray(0, size)) : null
}

/** Find every address in the target process whose bytes equal `needle` (bounded, read-only). */
function findProcessBytes(k: Kernel32, handle: bigint, needle: Buffer, deadline?: number): bigint[] {
  const hits: bigint[] = []
  let address = 0n
  const info = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)
  while (address < MAX_USER_ADDRESS && hits.length < MAX_MEMORY_HITS && (!deadline || Date.now() < deadline)) {
    info.fill(0)
    if (!Number(k.virtualQueryEx(handle, address, info, info.length))) break
    const base = info.readBigUInt64LE(0)
    const regionSizeBig = info.readBigUInt64LE(24)
    const state = info.readUInt32LE(32)
    const protect = info.readUInt32LE(36)
    if (state === MEM_COMMIT && isReadable(protect) && regionSizeBig > 0n && regionSizeBig <= BigInt(MAX_REGION_SIZE)) {
      const regionSize = Number(regionSizeBig)
      let offset = 0
      let trailing = Buffer.alloc(0)
      while (offset < regionSize && hits.length < MAX_MEMORY_HITS && (!deadline || Date.now() < deadline)) {
        const requested = Math.min(CHUNK_SIZE, regionSize - offset)
        const current = readRemote(k, handle, base + BigInt(offset), requested)
        if (current) {
          const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
          const searchableBase = base + BigInt(offset) - BigInt(trailing.length)
          let cursor = 0
          while (hits.length < MAX_MEMORY_HITS) {
            const match = searchable.indexOf(needle, cursor)
            if (match < 0) break
            hits.push(searchableBase + BigInt(match))
            cursor = match + 1
          }
          trailing = Buffer.from(searchable.subarray(Math.max(0, searchable.length - Math.max(0, needle.length - 1))))
        } else {
          trailing = Buffer.alloc(0)
        }
        offset += requested
      }
    }
    const next = base + regionSizeBig
    if (next <= address) break
    address = next
  }
  return hits
}

/**
 * Walk the WCDB `Config.Cipher` node and read the per-database key directly. This is the deterministic
 * WeChat 4.1.13+ path: it finds the `com.Tencent.WCDB.Config.Cipher` name, follows references to the
 * config object, XOR-decodes the stored blob and validates each embedded `x'<hex>'` run against the
 * encrypted first page. Returns a 'direct' (already-derived) 64-hex key.
 */
function scanConfigCipherKey(k: Kernel32, handle: bigint, encryptedFirstPage: Buffer, deadline?: number): { key: string | null; candidates: number } {
  const nameAddresses = findProcessBytes(k, handle, CONFIG_CIPHER_NAME, deadline)
  if (!nameAddresses.length) return { key: null, candidates: 0 }

  let candidates = 0
  const tested = new Set<string>()
  for (const nameAddress of nameAddresses) {
    const pair = Buffer.alloc(16)
    pair.writeBigUInt64LE(nameAddress, 0)
    pair.writeBigUInt64LE(BigInt(CONFIG_CIPHER_NAME.length), 8)
    const references = findProcessBytes(k, handle, pair, deadline)
    for (const reference of references) {
      const node = readRemote(k, handle, reference - 0x10n, 0x50)
      if (!node || node.readBigUInt64LE(0x10) !== nameAddress || node.readBigUInt64LE(0x18) !== BigInt(CONFIG_CIPHER_NAME.length)) continue
      const configAddress = node.readBigUInt64LE(0x28)
      const object = readRemote(k, handle, configAddress + 0x88n, 0x28)
      if (!object) continue
      const dataAddress = object.readBigUInt64LE(0x08)
      const dataLength = object.readBigUInt64LE(0x10)
      if (dataLength <= 0n || dataLength > 1024n) continue
      const blob = readRemote(k, handle, dataAddress, Number(dataLength))
      if (!blob) continue
      const decoded = Buffer.allocUnsafe(blob.length)
      for (let index = 0; index < blob.length; index += 1) {
        decoded[index] = (blob[index] ?? 0) ^ (CONFIG_XOR_MASK[index % CONFIG_XOR_MASK.length] ?? 0)
      }
      const text = decoded.toString('latin1')
      for (const match of text.matchAll(/[xX]'([0-9a-fA-F]{64,192})'/g)) {
        const run = (match[1] ?? '').toLowerCase()
        const starts = new Set<number>([0])
        if (run.length > 96) {
          for (let start = 0; start + 64 <= run.length; start += 32) starts.add(start)
          starts.add(run.length - 64)
        }
        for (const start of starts) {
          if (start < 0 || start + 64 > run.length) continue
          const hex = run.slice(start, start + 64)
          if (tested.has(hex)) continue
          tested.add(hex)
          const candidate = Buffer.from(hex, 'hex')
          if (candidate.length !== RAW_KEY_SIZE || new Set(candidate).size < 15) continue
          candidates += 1
          if (verifyDirectKey(candidate, encryptedFirstPage)) return { key: hex, candidates }
        }
      }
    }
  }
  return { key: null, candidates }
}

/** Read-only memory scan for the WeChat db key. Returns key:null when not found. */
export function scanWindowsDbKey(pid: number, dbPath: string, deadline?: number): WindowsDbKeyScanResult {
  const result: WindowsDbKeyScanResult = { key: null, opened: false, dbOk: false, bytes: 0, candidates: 0 }
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return result
  const salt = readEncryptedDbSalt(dbPath)
  const page = readFirstPage(dbPath)
  if (!salt || !page || page.length < SQLCIPHER_PAGE_SIZE) return result
  result.dbOk = true

  const funcs = loadKernel32()
  if (!funcs) return result
  const { openProcess, closeHandle } = funcs
  const k: Kernel32 = { virtualQueryEx: funcs.virtualQueryEx, readProcessMemory: funcs.readProcessMemory }

  const handle = BigInt(openProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid))
  if (!handle) return result
  result.opened = true

  // Path 1: the deterministic Config.Cipher node (WeChat 4.1.13+). Runs first because it is not a
  // brute-force over random UUID-shaped sequences and it works whenever the user is logged in.
  try {
    const config = scanConfigCipherKey(k, handle, page, deadline)
    result.candidates += config.candidates
    if (config.key) {
      result.key = config.key
      closeHandle(handle)
      return result
    }
  } catch {
    // Fall through to the legacy scans if a mapping changed mid-walk.
  }

  const rawCandidates: Buffer[] = []
  const seenRaw = new Set<string>()

  try {
    let address = 0n
    const info = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)
    while (address < MAX_USER_ADDRESS && !result.key && (!deadline || Date.now() < deadline)) {
      info.fill(0)
      if (!Number(k.virtualQueryEx(handle, address, info, MEMORY_BASIC_INFORMATION_X64_SIZE))) break
      const base = info.readBigUInt64LE(0)
      const regionSizeBig = info.readBigUInt64LE(24)
      const state = info.readUInt32LE(32)
      const protect = info.readUInt32LE(36)
      const type = info.readUInt32LE(40)
      if (regionSizeBig > 0n && regionSizeBig <= BigInt(MAX_REGION_SIZE) && state === MEM_COMMIT && type === MEM_PRIVATE && isWritableReadable(protect)) {
        const regionSize = Number(regionSizeBig)
        let offset = 0
        let trailing: Buffer = Buffer.alloc(0)
        while (offset < regionSize && !result.key && (!deadline || Date.now() < deadline)) {
          const requested = Math.min(CHUNK_SIZE, regionSize - offset)
          const current = readRemote(k, handle, base + BigInt(offset), requested)
          if (current) {
            result.bytes += requested
            const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
            const searchableBase = base + BigInt(offset) - BigInt(trailing.length)
            for (const rawKey of extractRawV4KeyCandidates(searchable, searchableBase)) {
              const id = rawKey.toString('hex')
              if (seenRaw.has(id)) continue
              seenRaw.add(id)
              result.candidates += 1
              if (rawCandidates.length < MAX_RAW_CANDIDATES) rawCandidates.push(rawKey)
            }
            const records = extractMemoryDbKeyCandidates(searchable)
            result.candidates += records.length
            const match = records.find((c) => c.salt === salt)
            if (match) {
              result.key = match.key
              break
            }
            trailing = searchable.subarray(Math.max(0, searchable.length - OVERLAP))
          } else {
            trailing = Buffer.alloc(0)
          }
          offset += requested
        }
      }
      const next = base + regionSizeBig
      if (next <= address) break
      address = next
    }
  } finally {
    closeHandle(handle)
  }

  if (!result.key) {
    for (const rawKey of rawCandidates) {
      if (verifyRawKey(rawKey, page)) {
        result.key = rawKey.toString('hex')
        break
      }
      if (verifyDirectKey(rawKey, page)) {
        result.key = rawKey.toString('hex')
        break
      }
    }
  }
  // If we recovered a raw record, confirm it matches this exact database page.
  if (result.key && classifyKeyAgainstPage(page, result.key) === null) result.key = null
  return result
}

/** Read-only image AES scan on Windows (verifies AES-128-ECB against a 16-byte ciphertext block). */
export function scanWindowsImageAesKey(pid: number, ciphertext: Buffer, deadline?: number): string | null {
  if (process.platform !== 'win32' || pid <= 0 || ciphertext.length !== 16) return null
  const funcs = loadKernel32()
  if (!funcs) return null
  const { openProcess, closeHandle } = funcs
  const k: Kernel32 = { virtualQueryEx: funcs.virtualQueryEx, readProcessMemory: funcs.readProcessMemory }
  const handle = BigInt(openProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid))
  if (!handle) return null
  try {
    let address = 0n
    const info = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)
    while (address < MAX_USER_ADDRESS && (!deadline || Date.now() < deadline)) {
      info.fill(0)
      if (!Number(k.virtualQueryEx(handle, address, info, MEMORY_BASIC_INFORMATION_X64_SIZE))) break
      const base = info.readBigUInt64LE(0)
      const regionSizeBig = info.readBigUInt64LE(24)
      const state = info.readUInt32LE(32)
      const protect = info.readUInt32LE(36)
      if (regionSizeBig > 0n && regionSizeBig <= BigInt(MAX_IMAGE_REGION_SIZE) && state === MEM_COMMIT && isWritableReadable(protect)) {
        const regionSize = Number(regionSizeBig)
        let offset = 0
        let trailing = Buffer.alloc(0)
        while (offset < regionSize && (!deadline || Date.now() < deadline)) {
          const requested = Math.min(CHUNK_SIZE, regionSize - offset)
          const current = readRemote(k, handle, base + BigInt(offset), requested)
          if (current) {
            const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
            const found = findWindowsImageAesKey(searchable, ciphertext)
            if (found.key) {
              closeHandle(handle)
              return found.key
            }
            trailing = Buffer.from(searchable.subarray(Math.max(0, searchable.length - IMAGE_KEY_OVERLAP_SIZE)))
          } else {
            trailing = Buffer.alloc(0)
          }
          offset += requested
        }
      }
      const next = base + regionSizeBig
      if (next <= address) break
      address = next
    }
  } finally {
    closeHandle(handle)
  }
  return null
}
