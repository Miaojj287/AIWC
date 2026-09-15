import { describe, expect, it } from 'vitest'
import { listZipEntries, readZipEntry, zipBaseName } from './zip'
import { buildZip } from './zipTestUtil'

describe('zip reader', () => {
  it('lists and extracts stored and deflated entries in nested folders', () => {
    const big = 'x'.repeat(10_000)
    const zip = buildZip([
      { name: 'my-pet/pet.json', data: '{"id":"my-pet"}' },
      { name: 'my-pet/spritesheet.webp', data: big, deflate: true },
    ])
    const entries = listZipEntries(zip)
    expect(entries.map((e) => [e.name, e.method])).toEqual([
      ['my-pet/pet.json', 0],
      ['my-pet/spritesheet.webp', 8],
    ])
    expect(zipBaseName(entries[1]!)).toBe('spritesheet.webp')
    expect(readZipEntry(zip, entries[0]!).toString()).toBe('{"id":"my-pet"}')
    expect(readZipEntry(zip, entries[1]!).toString()).toBe(big)
  })

  it('rejects files that are not zips or are truncated', () => {
    expect(() => listZipEntries(Buffer.from('hello'))).toThrow('压缩包无效')
    expect(() => listZipEntries(Buffer.alloc(64))).toThrow('找不到目录结尾')
    const zip = buildZip([{ name: 'pet.json', data: '{}' }])
    const cut = zip.subarray(0, zip.length - 40)
    expect(() => listZipEntries(cut)).toThrow('压缩包无效')
  })

  it('refuses an entry whose declared size does not match its content', () => {
    const zip = buildZip([{ name: 'a.txt', data: 'abcdef', deflate: true }])
    const entry = { ...listZipEntries(zip)[0]!, size: 3 }
    expect(() => readZipEntry(zip, entry)).toThrow('解压后大小不符')
  })
})
