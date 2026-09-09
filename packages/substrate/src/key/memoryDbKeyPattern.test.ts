import { describe, expect, it } from 'vitest'
import { extractMemoryDbKeyCandidates, extractRawV4KeyCandidates, matchCandidateToSalts } from './memoryDbKeyPattern'

describe('extractMemoryDbKeyCandidates', () => {
  it("finds x'<key><salt>' records embedded in noise", () => {
    const key = 'ab'.repeat(32) // 64 hex
    const salt = 'cd'.repeat(16) // 32 hex
    const record = Buffer.from(`x'${key}${salt}'`, 'ascii')
    const buffer = Buffer.concat([Buffer.from('garbage'), record, Buffer.from('more')])
    const candidates = extractMemoryDbKeyCandidates(buffer)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toEqual({ key, salt })
  })

  it('counts markers and dedupes', () => {
    const key = '11'.repeat(32)
    const salt = '22'.repeat(16)
    const record = Buffer.from(`x'${key}${salt}'`, 'ascii')
    const buffer = Buffer.concat([record, record])
    let markers = 0
    const candidates = extractMemoryDbKeyCandidates(buffer, () => (markers += 1))
    expect(candidates).toHaveLength(1)
    expect(markers).toBeGreaterThanOrEqual(2)
  })

  it('matches candidates to known salts', () => {
    const candidates = [
      { key: 'a'.repeat(64), salt: '00'.repeat(16) },
      { key: 'b'.repeat(64), salt: 'ff'.repeat(16) },
    ]
    const hit = matchCandidateToSalts(candidates, new Set(['ff'.repeat(16)]))
    expect(hit?.key).toBe('b'.repeat(64))
  })
})

describe('extractRawV4KeyCandidates', () => {
  it('finds two adjacent UUIDv4 blocks at 8-byte alignment', () => {
    const raw = Buffer.alloc(32)
    for (let i = 0; i < 32; i++) raw[i] = i + 1
    raw[6] = 0x40 | (raw[6]! & 0x0f)
    raw[8] = 0x80 | (raw[8]! & 0x3f)
    raw[16 + 6] = 0x40 | (raw[16 + 6]! & 0x0f)
    raw[16 + 8] = 0x80 | (raw[16 + 8]! & 0x3f)
    const buffer = Buffer.concat([Buffer.alloc(8), raw, Buffer.alloc(8)])
    const candidates = extractRawV4KeyCandidates(buffer, 0n)
    expect(candidates.some((c) => c.equals(raw))).toBe(true)
  })
})
