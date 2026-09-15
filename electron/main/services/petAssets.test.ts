import { describe, expect, it } from 'vitest'
import { inspectSpriteSheet, readImageSize, spriteVersionForSize } from './petAssets'

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

function webpVp8x(width: number, height: number): Buffer {
  const b = Buffer.alloc(40)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(32, 4)
  b.write('WEBP', 8, 'latin1')
  b.write('VP8X', 12, 'latin1')
  b.writeUIntLE(width - 1, 24, 3)
  b.writeUIntLE(height - 1, 27, 3)
  return b
}

function webpVp8l(width: number, height: number): Buffer {
  const b = Buffer.alloc(40)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write('VP8L', 12, 'latin1')
  b[20] = 0x2f
  b.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21)
  return b
}

function webpVp8(width: number, height: number): Buffer {
  const b = Buffer.alloc(40)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write('VP8 ', 12, 'latin1')
  b[23] = 0x9d
  b[24] = 0x01
  b[25] = 0x2a
  b.writeUInt16LE(width, 26)
  b.writeUInt16LE(height, 28)
  return b
}

describe('readImageSize', () => {
  it('reads PNG and all three WebP chunk layouts', () => {
    expect(readImageSize(png(1536, 1872))).toEqual({ width: 1536, height: 1872, format: 'png' })
    expect(readImageSize(webpVp8x(1536, 2288))).toEqual({ width: 1536, height: 2288, format: 'webp' })
    expect(readImageSize(webpVp8l(1536, 1872))).toEqual({ width: 1536, height: 1872, format: 'webp' })
    expect(readImageSize(webpVp8(1536, 2288))).toEqual({ width: 1536, height: 2288, format: 'webp' })
  })

  it('rejects other formats and truncated headers', () => {
    expect(readImageSize(Buffer.from('GIF89a…'))).toBeUndefined()
    expect(readImageSize(png(10, 10).subarray(0, 12))).toBeUndefined()
    expect(readImageSize(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('sprite sheet versions', () => {
  it('maps the two Codex Pets atlas sizes and nothing else', () => {
    expect(spriteVersionForSize({ width: 1536, height: 1872 })).toBe(1)
    expect(spriteVersionForSize({ width: 1536, height: 2288 })).toBe(2)
    expect(spriteVersionForSize({ width: 1536, height: 2080 })).toBeUndefined()
    expect(spriteVersionForSize({ width: 768, height: 936 })).toBeUndefined()
  })

  it('explains a wrong size, a non-image and a manifest / image mismatch', () => {
    expect(inspectSpriteSheet(webpVp8x(1536, 2288)).version).toBe(2)
    expect(() => inspectSpriteSheet(Buffer.from('not an image'))).toThrow('不是有效的 WebP / PNG')
    expect(() => inspectSpriteSheet(png(1024, 1024))).toThrow('当前 1024×1024')
    expect(() => inspectSpriteSheet(webpVp8x(1536, 1872), 2)).toThrow('标注的是 v2')
    expect(inspectSpriteSheet(webpVp8x(1536, 1872), 1).version).toBe(1)
  })
})
