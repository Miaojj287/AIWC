import { describe, expect, it } from 'vitest'
import { extractMemoryKeyCandidates } from '../../src/services/windowsMemoryKeyScanner.js'

describe('Windows open memory key pattern', () => {
  it('extracts a key and salt record without exposing unrelated bytes', () => {
    const key = 'ab'.repeat(32)
    const salt = 'cd'.repeat(16)
    const buffer = Buffer.from(`noise\0x'${key}${salt}'\0tail`, 'ascii')
    expect(extractMemoryKeyCandidates(buffer)).toEqual([{ key, salt }])
  })

  it('rejects malformed and truncated records', () => {
    const malformed = Buffer.from(`x'${'gg'.repeat(48)}'`, 'ascii')
    const truncated = Buffer.from(`x'${'ab'.repeat(32)}`, 'ascii')
    expect(extractMemoryKeyCandidates(malformed)).toEqual([])
    expect(extractMemoryKeyCandidates(truncated)).toEqual([])
  })

  it('finds records split by a scanner chunk overlap', () => {
    const key = '12'.repeat(32)
    const salt = '34'.repeat(16)
    const record = Buffer.from(`x'${key}${salt}'`, 'ascii')
    const first = Buffer.concat([Buffer.alloc(11), record.subarray(0, 47)])
    const second = Buffer.concat([first.subarray(first.length - 47), record.subarray(47)])
    expect(extractMemoryKeyCandidates(first)).toEqual([])
    expect(extractMemoryKeyCandidates(second)).toEqual([{ key, salt }])
  })
})
