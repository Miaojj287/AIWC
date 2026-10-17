/** Windows image AES scanning uses read-only process access and lazily loaded native functions. */
import { createDecipheriv } from 'node:crypto'
import { loadKernel32, type Kernel32 } from './windowsProcessMemory'

const PROCESS_VM_READ = 0x0010
const PROCESS_QUERY_INFORMATION = 0x0400
const MEM_COMMIT = 0x1000
const PAGE_GUARD = 0x100
const PAGE_NOCACHE = 0x200
const PAGE_WRITECOMBINE = 0x400
const PAGE_READWRITE = 0x04
const PAGE_WRITECOPY = 0x08
const PAGE_EXECUTE_READWRITE = 0x40
const PAGE_EXECUTE_WRITECOPY = 0x80
const MEMORY_BASIC_INFORMATION_X64_SIZE = 48
const MAX_USER_ADDRESS = 0x7fff_ffff_ffffn
const CHUNK_SIZE = 2 * 1024 * 1024
const IMAGE_KEY_OVERLAP_SIZE = 65
const MAX_IMAGE_REGION_SIZE = 100 * 1024 * 1024

function isWritableReadable(protect: number): boolean {
  const base = protect & ~(PAGE_GUARD | PAGE_NOCACHE | PAGE_WRITECOMBINE)
  return (
    base === PAGE_READWRITE ||
    base === PAGE_WRITECOPY ||
    base === PAGE_EXECUTE_READWRITE ||
    base === PAGE_EXECUTE_WRITECOPY
  )
}

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

function readRemote(k: Kernel32, handle: bigint, address: bigint, size: number): Buffer | null {
  if (address < 0x10000n || address >= MAX_USER_ADDRESS || size <= 0) return null
  const buffer = Buffer.allocUnsafe(size)
  const readBuf = Buffer.alloc(8)
  k.readProcessMemory(handle, address, buffer, size, readBuf)
  return readBuf.readBigUInt64LE(0) === BigInt(size) ? Buffer.from(buffer.subarray(0, size)) : null
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
      if (
        regionSizeBig > 0n &&
        regionSizeBig <= BigInt(MAX_IMAGE_REGION_SIZE) &&
        state === MEM_COMMIT &&
        isWritableReadable(protect)
      ) {
        const regionSize = Number(regionSizeBig)
        let offset = 0
        let trailing = Buffer.alloc(0)
        while (offset < regionSize && (!deadline || Date.now() < deadline)) {
          const requested = Math.min(CHUNK_SIZE, regionSize - offset)
          const current = readRemote(k, handle, base + BigInt(offset), requested)
          if (current) {
            const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
            const found = findWindowsImageAesKey(searchable, ciphertext)
            // `finally` closes the handle; closing it here as well can shut a handle that Windows has
            // already recycled for something else in this process.
            if (found.key) return found.key
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
