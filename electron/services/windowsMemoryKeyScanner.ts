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
const MEM_PRIVATE = 0x20000
const PAGE_READWRITE = 0x04
const PAGE_WRITECOPY = 0x08
const PAGE_READONLY = 0x02
const PAGE_EXECUTE_READ = 0x20
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
// UUID-shaped matches are noisy and PBKDF validation is deliberately expensive.
// Keep this legacy fallback tightly bounded; Config.Cipher is the deterministic
// primary path on current WeChat versions.
const MAX_RAW_CANDIDATES_TO_VALIDATE_PER_ROUND = 16
const CONFIG_CIPHER_NAME = Buffer.from('com.Tencent.WCDB.Config.Cipher', 'ascii')
const CONFIG_XOR_MASK = Buffer.from(
  'd2c7442458020000004889442450488b450048844c2448488944254048584c24',
  'hex'
)
const MAX_MEMORY_HITS = 128

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

function isReadablePage(protect: number): boolean {
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

function readSizeT(buffer: Buffer): bigint {
  return buffer.readBigUInt64LE(0)
}

type ReadProcessMemoryFn = (
  process: bigint,
  address: bigint,
  buffer: Buffer,
  size: number,
  bytesRead: Buffer
) => number

type VirtualQueryExFn = (
  process: bigint,
  address: bigint,
  info: Buffer,
  length: number
) => number | bigint

function readRemote(
  readProcessMemory: ReadProcessMemoryFn,
  processHandle: bigint,
  address: bigint,
  size: number
): Buffer | null {
  if (address < 0x10000n || address >= MAX_USER_ADDRESS || size <= 0) return null
  const buffer = Buffer.allocUnsafe(size)
  const bytesReadBuffer = Buffer.alloc(8)
  readProcessMemory(processHandle, address, buffer, size, bytesReadBuffer)
  const bytesReadBig = readSizeT(bytesReadBuffer)
  if (bytesReadBig !== BigInt(size)) return null
  return Buffer.from(buffer.subarray(0, size))
}

function findProcessBytes(
  virtualQueryEx: VirtualQueryExFn,
  readProcessMemory: ReadProcessMemoryFn,
  processHandle: bigint,
  needle: Buffer,
  deadline?: number
): bigint[] {
  const hits: bigint[] = []
  let address = 0n
  const memoryInfo = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)
  while (address < MAX_USER_ADDRESS && hits.length < MAX_MEMORY_HITS && (!deadline || Date.now() < deadline)) {
    memoryInfo.fill(0)
    if (!Number(virtualQueryEx(processHandle, address, memoryInfo, memoryInfo.length))) break
    const baseAddress = memoryInfo.readBigUInt64LE(0)
    const regionSizeBig = memoryInfo.readBigUInt64LE(24)
    const state = memoryInfo.readUInt32LE(32)
    const protect = memoryInfo.readUInt32LE(36)
    if (
      state === MEM_COMMIT &&
      isReadablePage(protect) &&
      regionSizeBig > 0n &&
      regionSizeBig <= BigInt(MAX_REGION_SIZE)
    ) {
      const regionSize = Number(regionSizeBig)
      let regionOffset = 0
      let trailing = Buffer.alloc(0)
      while (regionOffset < regionSize && hits.length < MAX_MEMORY_HITS && (!deadline || Date.now() < deadline)) {
        const requested = Math.min(CHUNK_SIZE, regionSize - regionOffset)
        const current = readRemote(readProcessMemory, processHandle, baseAddress + BigInt(regionOffset), requested)
        if (current) {
          const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
          const searchableBase = baseAddress + BigInt(regionOffset) - BigInt(trailing.length)
          let offset = 0
          while (hits.length < MAX_MEMORY_HITS) {
            const match = searchable.indexOf(needle, offset)
            if (match < 0) break
            hits.push(searchableBase + BigInt(match))
            offset = match + 1
          }
          trailing = Buffer.from(
            searchable.subarray(Math.max(0, searchable.length - Math.max(0, needle.length - 1)))
          )
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
  return hits
}

/** Verify a Config.Cipher derived database key against the encrypted first page. */
export function verifyWindowsDirectDbKey(key: Buffer, encryptedFirstPage: Buffer): boolean {
  if (key.length !== V4_KEY_SIZE || encryptedFirstPage.length < SQLCIPHER_PAGE_SIZE) return false
  try {
    const decipher = createDecipheriv(
      'aes-256-cbc',
      key,
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

function scanConfigCipherKey(
  virtualQueryEx: VirtualQueryExFn,
  readProcessMemory: ReadProcessMemoryFn,
  processHandle: bigint,
  encryptedFirstPage: Buffer,
  deadline?: number
): { key: string | null; candidates: number } {
  const nameAddresses = findProcessBytes(
    virtualQueryEx,
    readProcessMemory,
    processHandle,
    CONFIG_CIPHER_NAME,
    deadline
  )
  if (!nameAddresses.length) return { key: null, candidates: 0 }

  let candidates = 0
  const tested = new Set<string>()
  for (const nameAddress of nameAddresses) {
    const pair = Buffer.alloc(16)
    pair.writeBigUInt64LE(nameAddress, 0)
    pair.writeBigUInt64LE(BigInt(CONFIG_CIPHER_NAME.length), 8)
    const references = findProcessBytes(
      virtualQueryEx,
      readProcessMemory,
      processHandle,
      pair,
      deadline
    )
    for (const reference of references) {
      const node = readRemote(readProcessMemory, processHandle, reference - 0x10n, 0x50)
      if (!node || node.readBigUInt64LE(0x10) !== nameAddress || node.readBigUInt64LE(0x18) !== BigInt(CONFIG_CIPHER_NAME.length)) continue
      const configAddress = node.readBigUInt64LE(0x28)
      const object = readRemote(readProcessMemory, processHandle, configAddress + 0x88n, 0x28)
      if (!object) continue
      const dataAddress = object.readBigUInt64LE(0x08)
      const dataLength = object.readBigUInt64LE(0x10)
      if (dataLength <= 0n || dataLength > 1024n) continue
      const blob = readRemote(readProcessMemory, processHandle, dataAddress, Number(dataLength))
      if (!blob) continue
      const decoded = Buffer.allocUnsafe(blob.length)
      for (let index = 0; index < blob.length; index += 1) {
        decoded[index] = blob[index] ^ CONFIG_XOR_MASK[index % CONFIG_XOR_MASK.length]
      }
      const text = decoded.toString('latin1')
      for (const match of text.matchAll(/[xX]'([0-9a-fA-F]{64,192})'/g)) {
        const run = match[1].toLowerCase()
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
          if (candidate.length !== V4_KEY_SIZE || new Set(candidate).size < 15) continue
          candidates += 1
          if (verifyWindowsDirectDbKey(candidate, encryptedFirstPage)) {
            return { key: hex, candidates }
          }
        }
      }
    }
  }
  return { key: null, candidates }
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

  // WeChat 4.1.13+ keeps the usable per-database key inside an XOR-obfuscated
  // Config.Cipher blob. This deterministic path works after login and avoids
  // brute-forcing thousands of random UUID-shaped memory sequences.
  let configCipher = { key: null as string | null, candidates: 0 }
  try {
    configCipher = scanConfigCipherKey(
      virtualQueryEx as VirtualQueryExFn,
      readProcessMemory as ReadProcessMemoryFn,
      processHandle,
      encryptedFirstPage,
      options.deadline
    )
  } catch {
    // Keep the legacy ASCII/raw-key fallbacks available when a process exits
    // or changes its mappings during the two-pass Config.Cipher traversal.
  }
  result.candidates += configCipher.candidates
  if (configCipher.key) {
    result.key = configCipher.key
    closeHandle(processHandle)
    return result
  }

  try {
    let address = 0n
    const memoryInfo = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)

    while (
      address < MAX_USER_ADDRESS &&
      !result.key &&
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
      const type = memoryInfo.readUInt32LE(40)

      if (
        regionSizeBig > 0n &&
        regionSizeBig <= BigInt(MAX_REGION_SIZE) &&
        state === MEM_COMMIT &&
        type === MEM_PRIVATE &&
        isWritableReadablePage(protect)
      ) {
        const regionSize = Number(regionSizeBig)
        let regionOffset = 0
        let trailing = Buffer.alloc(0)

        while (
          regionOffset < regionSize &&
          !result.key &&
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
              if (pendingRawCandidates.length < MAX_RAW_CANDIDATES_TO_VALIDATE_PER_ROUND) {
                pendingRawCandidates.push(rawKey)
              }
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
  if (!result.key) {
    for (const rawKey of pendingRawCandidates) {
      if (verifyWindowsV4DbKey(rawKey, encryptedFirstPage)) {
        result.key = rawKey.toString('hex')
        break
      }
    }
  }

  return result
}
