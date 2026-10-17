import { describe, expect, it } from 'vitest'
import { authenticatedMainPageCount } from './sqlitePageExtent'
import { encryptPage, fixtureCipher, fixtureIv, plaintextPage } from './testing/sqlcipherFixture'

const PAGE_BYTES = 4096
const KEY = Buffer.alloc(32, 7)

function firstPage(declared: number, counter = 7, validFor = counter): Buffer {
  const plain = plaintextPage(1, 0)
  plain.writeUInt32BE(declared, 28)
  plain.writeUInt32BE(counter, 24)
  plain.writeUInt32BE(validFor, 92)
  return encryptPage(plain, KEY, 1, fixtureIv(11))
}

describe('authenticatedMainPageCount', () => {
  it('uses authenticated valid header size instead of preallocated physical pages', () => {
    expect(authenticatedMainPageCount(firstPage(3), fixtureCipher(KEY), 8 * PAGE_BYTES)).toBe(3)
  })
  it.each([
    [0, 7, 7],
    [3, 7, 8],
  ])('uses physical pages for an invalid SQLite size field (%i/%i/%i)', (count, counter, validFor) => {
    expect(authenticatedMainPageCount(firstPage(count, counter, validFor), fixtureCipher(KEY), 8 * PAGE_BYTES)).toBe(8)
  })
  it.each([0, PAGE_BYTES - 1, PAGE_BYTES + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid physical byte count (%s)',
    (bytes) => expect(authenticatedMainPageCount(firstPage(1), fixtureCipher(KEY), bytes)).toBeUndefined(),
  )
  it('rejects a valid declared count larger than the physical file', () => {
    expect(authenticatedMainPageCount(firstPage(9), fixtureCipher(KEY), 8 * PAGE_BYTES)).toBeUndefined()
  })
  it('does not trust a header when its authentication or AES structure fails', () => {
    const tampered = firstPage(1)
    tampered[100] = (tampered[100] ?? 0) ^ 1
    expect(authenticatedMainPageCount(tampered, fixtureCipher(KEY), 8 * PAGE_BYTES)).toBeUndefined()
    const invalid = plaintextPage(1, 0)
    invalid[16] = 0
    expect(
      authenticatedMainPageCount(encryptPage(invalid, KEY, 1, fixtureIv(12)), fixtureCipher(KEY), PAGE_BYTES),
    ).toBeUndefined()
  })
  it('never truncates from an unauthenticated legacy header', () => {
    expect(authenticatedMainPageCount(firstPage(1), { ...fixtureCipher(KEY), hmacKey: null }, 8 * PAGE_BYTES)).toBe(8)
  })
})
