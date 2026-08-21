import { closeSync, openSync, readSync } from 'node:fs'

const PROCESS_VM_READ = 0x0010
const PROCESS_QUERY_INFORMATION = 0x0400
const MEM_COMMIT = 0x1000
const WRITABLE_PAGES = new Set([0x04, 0x08, 0x40, 0x80])
const PROTECTION_FLAGS = 0x100 | 0x200 | 0x400
const INFO_SIZE = 48
const MAX_ADDRESS = 0x7fff_ffff_ffffn
const MAX_REGION = 512 * 1024 * 1024
const CHUNK_SIZE = 2 * 1024 * 1024
const RECORD_SIZE = 99
const OVERLAP = RECORD_SIZE - 1

export interface MemoryKeyCandidate {
  key: string
  salt: string
}

export interface WindowsMemoryScanResult {
  key: string | null
  dbOk: boolean
  attached: boolean
  bytes: number
  markers: number
  candidates: number
}

export function readEncryptedDbSalt(dbPath: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(dbPath, 'r')
    const header = Buffer.alloc(16)
    if (readSync(fd, header, 0, header.length, 0) !== header.length) return null
    if (header.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) return null
    return header.toString('hex')
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function isHex(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x46) ||
    (byte >= 0x61 && byte <= 0x66)
}

/** Extract WCDB records stored as x'<64 hex key><32 hex salt>'. */
export function extractMemoryKeyCandidates(data: Buffer, onMarker?: () => void): MemoryKeyCandidate[] {
  const found: MemoryKeyCandidate[] = []
  const seen = new Set<string>()
  let offset = 0
  while (offset + RECORD_SIZE <= data.length) {
    const marker = data.indexOf("x'", offset, 'ascii')
    if (marker < 0 || marker + RECORD_SIZE > data.length) break
    onMarker?.()
    const start = marker + 2
    const end = start + 96
    let valid = data[end] === 0x27
    for (let index = start; valid && index < end; index += 1) valid = isHex(data[index])
    if (valid) {
      const key = data.subarray(start, start + 64).toString('ascii').toLowerCase()
      const salt = data.subarray(start + 64, end).toString('ascii').toLowerCase()
      const identity = `${key}:${salt}`
      if (!seen.has(identity)) {
        seen.add(identity)
        found.push({ key, salt })
      }
    }
    offset = marker + 2
  }
  return found
}

/** Read-only Windows process scan; it never injects code or writes process memory. */
export async function scanWindowsMemoryForDbKey(
  pid: number,
  dbPath: string
): Promise<WindowsMemoryScanResult> {
  const targetSalt = readEncryptedDbSalt(dbPath)
  const result: WindowsMemoryScanResult = {
    key: null,
    dbOk: !!targetSalt,
    attached: false,
    bytes: 0,
    markers: 0,
    candidates: 0,
  }
  if (process.platform !== 'win32' || !targetSalt || pid <= 0) return result

  const mod: any = await import('koffi')
  const koffi = mod.default || mod
  const kernel32 = koffi.load('kernel32.dll')
  const openProcess = kernel32.func('uintptr_t OpenProcess(uint32_t, int, uint32_t)')
  const virtualQueryEx = kernel32.func(
    'size_t VirtualQueryEx(uintptr_t, uintptr_t, _Out_ uint8_t *, size_t)'
  )
  const readProcessMemory = kernel32.func(
    'int ReadProcessMemory(uintptr_t, uintptr_t, _Out_ uint8_t *, size_t, _Out_ size_t *)'
  )
  const closeHandle = kernel32.func('int CloseHandle(uintptr_t)')
  const handle = BigInt(openProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid))
  if (!handle) return result
  result.attached = true

  try {
    let address = 0n
    const info = Buffer.alloc(INFO_SIZE)
    while (address < MAX_ADDRESS && !result.key) {
      info.fill(0)
      if (!Number(virtualQueryEx(handle, address, info, INFO_SIZE))) break
      const base = info.readBigUInt64LE(0)
      const sizeBig = info.readBigUInt64LE(24)
      const state = info.readUInt32LE(32)
      const protection = info.readUInt32LE(36)
      const page = protection & ~PROTECTION_FLAGS

      if (sizeBig > 0n && sizeBig <= BigInt(MAX_REGION) && state === MEM_COMMIT && WRITABLE_PAGES.has(page)) {
        const size = Number(sizeBig)
        let regionOffset = 0
        let trailing = Buffer.alloc(0)
        while (regionOffset < size && !result.key) {
          const requested = Math.min(CHUNK_SIZE, size - regionOffset)
          const chunk = Buffer.allocUnsafe(requested)
          const bytesRead = Buffer.alloc(8)
          readProcessMemory(handle, base + BigInt(regionOffset), chunk, requested, bytesRead)
          const actualBig = bytesRead.readBigUInt64LE(0)
          const actual = actualBig <= BigInt(requested) ? Number(actualBig) : 0
          if (actual > 0) {
            result.bytes += actual
            const current = chunk.subarray(0, actual)
            const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
            const candidates = extractMemoryKeyCandidates(searchable, () => { result.markers += 1 })
            result.candidates += candidates.length
            result.key = candidates.find(candidate => candidate.salt === targetSalt)?.key || null
            trailing = searchable.subarray(Math.max(0, searchable.length - OVERLAP))
          } else {
            trailing = Buffer.alloc(0)
          }
          regionOffset += requested
        }
      }

      const next = base + sizeBig
      if (next <= address) break
      address = next
    }
  } finally {
    closeHandle(handle)
  }
  return result
}
