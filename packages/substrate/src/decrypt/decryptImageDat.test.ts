import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptImageDat } from './decryptImageDat'
import { encryptDatV4 } from './datDecryptCore'

const dir = mkdtempSync(join(tmpdir(), 'aiwc-decrypt-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakePng(size: number): Buffer {
  const body = Buffer.alloc(size, 0x42)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body, 0)
  // IEND at the tail so completeness heuristics would pass downstream.
  Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]).copy(body, size - 8)
  return body
}

describe('decryptImageDat (pure TS path)', () => {
  it('decrypts a V4 dat and appends the sniffed extension', async () => {
    const plain = fakePng(4096)
    const aesKey = Buffer.from('0123456789abcdef', 'ascii')
    const src = join(dir, 'in.dat')
    writeFileSync(src, encryptDatV4(plain, 0x37, aesKey))

    const result = await decryptImageDat({ src, dst: join(dir, 'out'), xorKey: 0x37, aesKey: '0123456789abcdef' })
    expect(result.ext).toBe('.png')
    expect(result.path).toBe(join(dir, 'out.png'))
    expect(result.source).toBe('ts')
    expect(readFileSync(result.path).equals(plain)).toBe(true)
  })

  it('replaces a .dat extension on the destination', async () => {
    const plain = fakePng(2048)
    const src = join(dir, 'in2.dat')
    writeFileSync(src, encryptDatV4(plain, 0x10, Buffer.from('abcdefabcdefabcd', 'ascii')))
    const result = await decryptImageDat({ src, dst: join(dir, 'out2.dat'), xorKey: 0x10, aesKey: 'abcdefabcdefabcd' })
    expect(result.path).toBe(join(dir, 'out2.png'))
  })

  it('accepts hex xor and hex aes keys', async () => {
    const plain = fakePng(1024)
    const aesAscii = 'ffeeddccbbaa9988'
    const src = join(dir, 'in3.dat')
    writeFileSync(src, encryptDatV4(plain, 0x2a, Buffer.from(aesAscii, 'ascii')))
    const result = await decryptImageDat({
      src,
      dst: join(dir, 'out3'),
      xorKey: '2a',
      aesKey: Buffer.from(aesAscii, 'ascii').toString('hex'),
    })
    expect(readFileSync(result.path).equals(plain)).toBe(true)
  })
})
