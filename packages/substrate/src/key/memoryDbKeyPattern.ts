/**
 * Byte patterns for WCDB SQLCipher key records found in process memory / crash dumps:
 * the ASCII form `x'<64 hex key><32 hex salt>'` (99 bytes) and the transient raw 32-byte key
 * stored as two UUIDv4 blocks (WeChat 4.1.x). Pure functions, tested on synthetic buffers.
 */

export const ASCII_RECORD_SIZE = 99
export const RAW_KEY_SIZE = 32

export interface MemoryDbKeyCandidate {
  key: string
  salt: string
}

function isAsciiHex(value: number): boolean {
  return (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x46) || (value >= 0x61 && value <= 0x66)
}

/** Extract `x'<key><salt>'` records; `onMarker` counts every `x'` seen (diagnostics). */
export function extractMemoryDbKeyCandidates(data: Buffer, onMarker?: () => void): MemoryDbKeyCandidate[] {
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
    for (let index = hexStart; valid && index < hexEnd; index += 1) valid = isAsciiHex(data[index] ?? 0)
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

function isUuidV4At(data: Buffer, offset: number): boolean {
  return (
    offset >= 0 &&
    offset + 16 <= data.length &&
    ((data[offset + 6] ?? 0) & 0xf0) === 0x40 &&
    ((data[offset + 8] ?? 0) & 0xc0) === 0x80
  )
}

/** Raw 32-byte key candidates = two consecutive UUIDv4 blocks at 8-byte alignment. */
export function extractRawV4KeyCandidates(data: Buffer, baseAddress = 0n): Buffer[] {
  const candidates: Buffer[] = []
  const baseRemainder = Number(baseAddress % 8n)
  for (let offset = (8 - baseRemainder) % 8; offset + RAW_KEY_SIZE <= data.length; offset += 8) {
    if (isUuidV4At(data, offset) && isUuidV4At(data, offset + 16)) {
      candidates.push(Buffer.from(data.subarray(offset, offset + RAW_KEY_SIZE)))
    }
  }
  return candidates
}

/** Pick the record whose salt matches one of the account's databases. */
export function matchCandidateToSalts(candidates: MemoryDbKeyCandidate[], salts: ReadonlySet<string>): MemoryDbKeyCandidate | undefined {
  return candidates.find((c) => salts.has(c.salt))
}
