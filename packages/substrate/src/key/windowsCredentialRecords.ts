import { extractMemoryDbKeyCandidates, ASCII_RECORD_SIZE, type MemoryDbKeyCandidate } from './memoryDbKeyPattern'

// Existing Windows Config.Cipher mask; candidates are untrusted until database authentication.
// Weixin.dll 4.1.15.53 identity and runtime evidence are recorded in WECHAT-LOGIN-KEY-RESEARCH.md.
const CONFIG_XOR_MASK = Buffer.from('d2c7442458020000004889442450488b450048844c2448488944254048584c24', 'hex')
const MASKED_PREFIX = Buffer.from([0x78 ^ (CONFIG_XOR_MASK[0] ?? 0), 0x27 ^ (CONFIG_XOR_MASK[1] ?? 0)])

/** Decode bounded plaintext or masked SQLCipher keyspec candidates without assuming object offsets. */
export function extractWindowsCredentialRecords(bytes: Buffer): MemoryDbKeyCandidate[] {
  const records = extractMemoryDbKeyCandidates(bytes)
  let cursor = 0
  while (cursor + ASCII_RECORD_SIZE <= bytes.length) {
    const start = bytes.indexOf(MASKED_PREFIX, cursor)
    if (start < 0 || start + ASCII_RECORD_SIZE > bytes.length) break
    cursor = start + MASKED_PREFIX.length
    const decoded = Buffer.alloc(ASCII_RECORD_SIZE)
    try {
      for (let index = 0; index < decoded.length; index += 1)
        decoded[index] = (bytes[start + index] ?? 0) ^ (CONFIG_XOR_MASK[index % CONFIG_XOR_MASK.length] ?? 0)
      records.push(...extractMemoryDbKeyCandidates(decoded))
    } finally {
      decoded.fill(0)
    }
  }
  return records
}
