import {
  extractMemoryDbKeyCandidates,
  readEncryptedDbSalt,
  type MemoryDbKeyCandidate,
} from './memoryDbKeyPattern'
import koffi from 'koffi'
import { createDecipheriv, pbkdf2Sync } from 'crypto'
import { closeSync, openSync, readSync } from 'fs'

export { readEncryptedDbSalt } from './memoryDbKeyPattern'

const PROCESS_VM_READ = 0x0010
const PROCESS_QUERY_INFORMATION = 0x0400

const MEM_COMMIT = 0x1000
const PAGE_READWRITE = 0x04
const PAGE_WRITECOPY = 0x08
const PAGE_EXECUTE_READWRITE = 0x40
const PAGE_EXECUTE_WRITECOPY = 0x80
const PAGE_GUARD = 0x100
const PAGE_NOCACHE = 0x200
const PAGE_WRITECOMBINE = 0x400

const MEMORY_BASIC_INFORMATION_X64_SIZE = 48
const MAX_USER_ADDRESS = 0x7fff_ffff_ffffn
const MAX_REGION_SIZE = 512 * 1024 * 1024
const CHUNK_SIZE = 2 * 1024 * 1024
const ASCII_RECORD_SIZE = 99 // x' + 96 hex chars + '
const OVERLAP_SIZE = ASCII_RECORD_SIZE - 1
const V4_KEY_SIZE = 32
const SQLCIPHER_PAGE_SIZE = 4096
// A fresh 4.1.x login can materialize a few hundred UUID-shaped objects in one
// allocation wave. They are copied before validation, so it is safe to spend a
// bounded amount of time checking that captured snapshot after the read pass.
const MAX_RAW_CANDIDATES_TO_VALIDATE_PER_ROUND = 512
const TRANSIENT_SCAN_BYTE_LIMIT = 64 * 1024 * 1024

export type WindowsMemoryKeyCandidate = MemoryDbKeyCandidate

export interface WindowsMemoryKeyScanResult {
  key: string | null
  auth: true
  dbOk: boolean
  pids: number
  opened: number
  bytes: number
  markers: number
  candidates: number
}

export interface WindowsMemoryKeyScanOptions {
  /** Stop between memory regions/chunks once this wall-clock deadline is reached. */
  deadline?: number
  /** Candidates retained across polling rounds so only newly loaded keys need PBKDF validation. */
  seenRawCandidates?: Set<string>
  /** The first pre-login round establishes a baseline and intentionally skips validation. */
  validateNewRawCandidates?: boolean
}

export interface WeChatProcessInfo {
  pid: number
  workingSetKb: number
}

/** Parse tasklist CSV and put the most likely data-bearing Weixin process first. */
export function parseWeChatTasklist(output: string): WeChatProcessInfo[] {
  const processes: WeChatProcessInfo[] = []
  for (const line of output.trim().split(/\r?\n/)) {
    const fields = Array.from(line.matchAll(/"([^"]*)"/g), match => match[1])
    if (fields.length < 2 || fields[0].toLowerCase() !== 'weixin.exe') continue
    const pid = Number.parseInt(fields[1], 10)
    if (!Number.isInteger(pid) || pid <= 0) continue
    const workingSetKb = Number.parseInt(String(fields[4] || '').replace(/\D/g, ''), 10) || 0
    processes.push({ pid, workingSetKb })
  }
  return processes.sort((left, right) => right.workingSetKb - left.workingSetKb)
}

/**
 * Extract WeChat 4.x SQLCipher records stored as x'<64 hex key><32 hex salt>'.
 * Exported separately so the byte-pattern logic can be tested on every platform.
 */
export function extractWindowsMemoryKeyCandidates(
  data: Buffer,
  onMarker?: () => void
): WindowsMemoryKeyCandidate[] {
  return extractMemoryDbKeyCandidates(data, onMarker)
}

function isUuidV4At(data: Buffer, offset: number): boolean {
  return (
    offset >= 0 &&
    offset + 16 <= data.length &&
    (data[offset + 6] & 0xf0) === 0x40 &&
    (data[offset + 8] & 0xc0) === 0x80
  )
}

/** Extract the transient 4.1.x raw key representation (two UUIDv4 byte blocks). */
export function extractWindowsRawV4KeyCandidates(data: Buffer, baseAddress = 0n): Buffer[] {
  const candidates: Buffer[] = []
  const baseRemainder = Number(baseAddress % 8n)
  let offset = (8 - baseRemainder) % 8
  for (; offset + V4_KEY_SIZE <= data.length; offset += 8) {
    if (isUuidV4At(data, offset) && isUuidV4At(data, offset + 16)) {
      candidates.push(Buffer.from(data.subarray(offset, offset + V4_KEY_SIZE)))
    }
  }
  return candidates
}

function readEncryptedDbFirstPage(dbPath: string): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(dbPath, 'r')
    const page = Buffer.alloc(SQLCIPHER_PAGE_SIZE)
    if (readSync(fd, page, 0, page.length, 0) !== page.length) return null
    if (page.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) return null
    return page
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Validate a raw WeChat 4.x database key without exposing or persisting it. */
export function verifyWindowsV4DbKey(key: Buffer, encryptedFirstPage: Buffer): boolean {
  if (key.length !== V4_KEY_SIZE || encryptedFirstPage.length < SQLCIPHER_PAGE_SIZE) return false
  try {
    const salt = encryptedFirstPage.subarray(0, 16)
    const derivedKey = pbkdf2Sync(key, salt, 256_000, 32, 'sha512')
    const decipher = createDecipheriv(
      'aes-256-cbc',
      derivedKey,
      encryptedFirstPage.subarray(4016, 4032)
    )
    decipher.setAutoPadding(false)
    const decrypted = Buffer.concat([
      decipher.update(encryptedFirstPage.subarray(16, 4016)),
      decipher.final(),
    ])
    return (
      decrypted[0] === 0x10 &&
      decrypted[1] === 0x00 &&
      (decrypted[2] === 1 || decrypted[2] === 2) &&
      (decrypted[3] === 1 || decrypted[3] === 2) &&
      decrypted[4] === 0x50 &&
      decrypted[5] === 0x40 &&
      decrypted[6] === 0x20 &&
      decrypted[7] === 0x20
    )
  } catch {
    return false
  }
}

function isWritableReadablePage(protect: number): boolean {
  const base = protect & ~(PAGE_GUARD | PAGE_NOCACHE | PAGE_WRITECOMBINE)
  return (
    base === PAGE_READWRITE ||
    base === PAGE_WRITECOPY ||
    base === PAGE_EXECUTE_READWRITE ||
    base === PAGE_EXECUTE_WRITECOPY
  )
}

function readSizeT(buffer: Buffer): bigint {
  return buffer.readBigUInt64LE(0)
}

/**
 * Open implementation of the Windows key+salt memory scan used by WeChat 4.x.
 *
 * The scan is intentionally read-only: it requests PROCESS_VM_READ and
 * PROCESS_QUERY_INFORMATION, and never writes to or injects code into WeChat.
 * See THIRD_PARTY_NOTICES.md for the implementation reference and attribution.
 */
export function scanWindowsMemoryForDbKey(
  pid: number,
  dbPath: string,
  options: WindowsMemoryKeyScanOptions = {}
): WindowsMemoryKeyScanResult {
  const result: WindowsMemoryKeyScanResult = {
    key: null,
    auth: true,
    dbOk: false,
    pids: pid > 0 ? 1 : 0,
    opened: 0,
    bytes: 0,
    markers: 0,
    candidates: 0,
  }

  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return result

  const targetSalt = readEncryptedDbSalt(dbPath)
  const encryptedFirstPage = readEncryptedDbFirstPage(dbPath)
  if (!targetSalt || !encryptedFirstPage) return result
  result.dbOk = true

  const kernel32 = koffi.load('kernel32.dll')
  const openProcess = kernel32.func(
    'uintptr_t OpenProcess(uint32_t desiredAccess, int inheritHandle, uint32_t processId)'
  )
  const virtualQueryEx = kernel32.func(
    'size_t VirtualQueryEx(uintptr_t process, uintptr_t address, _Out_ uint8_t *info, size_t length)'
  )
  const readProcessMemory = kernel32.func(
    'int ReadProcessMemory(uintptr_t process, uintptr_t address, _Out_ uint8_t *buffer, size_t size, _Out_ size_t *bytesRead)'
  )
  const closeHandle = kernel32.func('int CloseHandle(uintptr_t handle)')

  const processHandle = BigInt(openProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid))
  if (!processHandle || processHandle === 0n) return result
  result.opened = 1
  const pendingRawCandidates: Buffer[] = []

  try {
    let address = 0n
    const memoryInfo = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)

    while (
      address < MAX_USER_ADDRESS &&
      !result.key &&
      (!options.seenRawCandidates || result.bytes < TRANSIENT_SCAN_BYTE_LIMIT) &&
      (!options.deadline || Date.now() < options.deadline)
    ) {
      memoryInfo.fill(0)
      const querySize = Number(
        virtualQueryEx(processHandle, address, memoryInfo, MEMORY_BASIC_INFORMATION_X64_SIZE)
      )
      if (!querySize) break

      const baseAddress = memoryInfo.readBigUInt64LE(0)
      const regionSizeBig = memoryInfo.readBigUInt64LE(24)
      const state = memoryInfo.readUInt32LE(32)
      const protect = memoryInfo.readUInt32LE(36)

      if (
        regionSizeBig > 0n &&
        regionSizeBig <= BigInt(MAX_REGION_SIZE) &&
        state === MEM_COMMIT &&
        isWritableReadablePage(protect)
      ) {
        const regionSize = Number(regionSizeBig)
        let regionOffset = 0
        let trailing = Buffer.alloc(0)

        while (
          regionOffset < regionSize &&
          !result.key &&
          (!options.seenRawCandidates || result.bytes < TRANSIENT_SCAN_BYTE_LIMIT) &&
          (!options.deadline || Date.now() < options.deadline)
        ) {
          const requested = Math.min(CHUNK_SIZE, regionSize - regionOffset)
          const chunk = Buffer.allocUnsafe(requested)
          const bytesReadBuffer = Buffer.alloc(8)
          readProcessMemory(
            processHandle,
            baseAddress + BigInt(regionOffset),
            chunk,
            requested,
            bytesReadBuffer
          )

          const bytesReadBig = readSizeT(bytesReadBuffer)
          const bytesRead = bytesReadBig <= BigInt(requested) ? Number(bytesReadBig) : 0
          if (bytesRead > 0) {
            result.bytes += bytesRead
            const current = chunk.subarray(0, bytesRead)
            const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
            const searchableBase = baseAddress + BigInt(regionOffset) - BigInt(trailing.length)
            const rawCandidates = extractWindowsRawV4KeyCandidates(searchable, searchableBase)
            for (const rawKey of rawCandidates) {
              const identity = rawKey.toString('hex')
              if (options.seenRawCandidates?.has(identity)) continue
              options.seenRawCandidates?.add(identity)
              result.candidates += 1
              if (options.validateNewRawCandidates !== false) pendingRawCandidates.push(rawKey)
            }
            const candidates = extractWindowsMemoryKeyCandidates(searchable, () => {
              result.markers += 1
            })
            result.candidates += candidates.length
            const match = candidates.find(candidate => candidate.salt === targetSalt)
            if (match) {
              result.key = match.key
              break
            }
            trailing = searchable.subarray(Math.max(0, searchable.length - OVERLAP_SIZE))
          } else {
            trailing = Buffer.alloc(0)
          }
          regionOffset += requested
        }
      }

      const nextAddress = baseAddress + regionSizeBig
      if (nextAddress <= address) break
      address = nextAddress
    }
  } finally {
    closeHandle(processHandle)
  }

  // Copy every transient candidate during the fast memory pass first. PBKDF is
  // intentionally deferred: validating inline can take long enough for a key
  // in a later region to disappear before that region is read.
  if (
    !result.key &&
    pendingRawCandidates.length <= MAX_RAW_CANDIDATES_TO_VALIDATE_PER_ROUND
  ) {
    for (const rawKey of pendingRawCandidates) {
      if (verifyWindowsV4DbKey(rawKey, encryptedFirstPage)) {
        result.key = rawKey.toString('hex')
        break
      }
    }
  }

  return result
}
