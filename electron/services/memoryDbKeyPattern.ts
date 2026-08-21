import { closeSync, openSync, readSync } from 'fs'

const ASCII_RECORD_SIZE = 99

export interface MemoryDbKeyCandidate {
  key: string
  salt: string
}

export function readEncryptedDbSalt(dbPath: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(dbPath, 'r')
    const head = Buffer.alloc(16)
    if (readSync(fd, head, 0, head.length, 0) !== head.length) return null
    if (head.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) return null
    return head.toString('hex')
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function isAsciiHex(value: number): boolean {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66)
  )
}

/** Extract WCDB SQLCipher records stored as x'<64 hex key><32 hex salt>'. */
export function extractMemoryDbKeyCandidates(
  data: Buffer,
  onMarker?: () => void
): MemoryDbKeyCandidate[] {
  const results: MemoryDbKeyCandidate[] = []
  const seen = new Set<string>()
  let offset = 0
  while (offset + ASCII_RECORD_SIZE <= data.length) {
    const marker = data.indexOf("x'", offset, 'ascii')
    if (marker < 0 || marker + ASCII_RECORD_SIZE > data.length) break
    onMarker?.()
    const hexStart = marker + 2
    const hexEnd = hexStart + 96
    let valid = data[hexEnd] === 0x27
    for (let index = hexStart; valid && index < hexEnd; index += 1) {
      valid = isAsciiHex(data[index])
    }
    if (valid) {
      const key = data.subarray(hexStart, hexStart + 64).toString('ascii').toLowerCase()
      const salt = data.subarray(hexStart + 64, hexEnd).toString('ascii').toLowerCase()
      const identity = `${key}:${salt}`
      if (!seen.has(identity)) {
        seen.add(identity)
        results.push({ key, salt })
      }
    }
    offset = marker + 2
  }
  return results
}
