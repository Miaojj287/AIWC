import {
  extractMemoryDbKeyCandidates,
  readEncryptedDbSalt,
  type MemoryDbKeyCandidate,
} from './memoryDbKeyPattern'

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
  dbPath: string
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
  if (!targetSalt) return result
  result.dbOk = true

  const koffi = require('koffi')
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

  try {
    let address = 0n
    const memoryInfo = Buffer.alloc(MEMORY_BASIC_INFORMATION_X64_SIZE)

    while (address < MAX_USER_ADDRESS && !result.key) {
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

        while (regionOffset < regionSize && !result.key) {
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

  return result
}
