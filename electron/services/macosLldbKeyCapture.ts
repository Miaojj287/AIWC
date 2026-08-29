import crypto from 'crypto'
import { existsSync, readFileSync } from 'fs'

export const DB_PAGE_SIZE = 4096
const DB_RESERVED_SIZE = 80

/** Parse only the byte dump produced by our explicit LLDB memory-read command. */
export function parseLldbKeyBytes(output: string): Buffer | null {
  const marker = 'memory read --force --format x --size 1 --count 32 $x1'
  const markerOffset = output.lastIndexOf(marker)
  if (markerOffset < 0) return null

  const bodyStart = output.indexOf('\n', markerOffset)
  if (bodyStart < 0) return null
  const nextCommand = output.indexOf('\n(lldb)', bodyStart + 1)
  const body = output.slice(bodyStart + 1, nextCommand < 0 ? undefined : nextCommand)
  const bytes: number[] = []

  for (const line of body.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const tokenPattern = /\b(?:0x)?([0-9a-fA-F]{2})\b/g
    let match: RegExpExecArray | null
    while ((match = tokenPattern.exec(line.slice(colon + 1))) !== null) {
      bytes.push(parseInt(match[1], 16))
      if (bytes.length === 32) return Buffer.from(bytes)
    }
  }
  return null
}

export function validateRawDbKey(dbPath: string, rawKey: Buffer): boolean {
  if (rawKey.length !== 32 || !existsSync(dbPath)) return false
  try {
    const page = readFileSync(dbPath).subarray(0, DB_PAGE_SIZE)
    if (page.length !== DB_PAGE_SIZE) return false
    const derived = crypto.pbkdf2Sync(rawKey, page.subarray(0, 16), 256_000, 32, 'sha512')
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      derived,
      page.subarray(DB_PAGE_SIZE - DB_RESERVED_SIZE, DB_PAGE_SIZE - DB_RESERVED_SIZE + 16)
    )
    decipher.setAutoPadding(false)
    const plain = Buffer.concat([
      decipher.update(page.subarray(16, DB_PAGE_SIZE - DB_RESERVED_SIZE)),
      decipher.final()
    ])
    return plain[0] === 0x10 && plain[1] === 0x00 &&
      (plain[2] === 1 || plain[2] === 2) &&
      (plain[3] === 1 || plain[3] === 2) &&
      plain[4] === DB_RESERVED_SIZE && plain[5] === 0x40 &&
      plain[6] === 0x20 && plain[7] === 0x20
  } catch {
    return false
  }
}
