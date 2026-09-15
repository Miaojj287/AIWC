import { describe, expect, it } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import {
  coerceRowNumber,
  coerceRowString,
  decodeBinaryContent,
  decodeMaybeCompressed,
  decodeMessageContent,
  decodeHtmlEntities,
  extractXmlAttribute,
  extractXmlValue,
  getRowField,
  looksLikeHex,
  looksLikeWxid,
  readProtoVarint,
  stripSenderPrefix,
} from './rowDecoders'

describe('coerceRowNumber', () => {
  it('handles numbers, bigints, strings and junk', () => {
    expect(coerceRowNumber(42)).toBe(42)
    expect(coerceRowNumber(10n)).toBe(10)
    expect(coerceRowNumber('  7 ')).toBe(7)
    expect(coerceRowNumber('', 5)).toBe(5)
    expect(coerceRowNumber('abc', -1)).toBe(-1)
    expect(coerceRowNumber(Number.NaN, 3)).toBe(3)
  })
})

describe('coerceRowString', () => {
  it('decodes buffers and trims', () => {
    expect(coerceRowString(Buffer.from('hi'))).toBe('hi')
    expect(coerceRowString('  x ')).toBe('x')
    expect(coerceRowString('')).toBeUndefined()
    expect(coerceRowString(null)).toBeUndefined()
  })
})

describe('getRowField', () => {
  it('matches exact then case-insensitively', () => {
    const row = { CreateTime: 5, message_content: 'a' }
    expect(getRowField(row, ['create_time', 'CreateTime'])).toBe(5)
    expect(getRowField(row, ['createtime'])).toBe(5)
    expect(getRowField(row, ['missing'])).toBeUndefined()
  })
})

describe('xml helpers', () => {
  it('extracts values and attributes and decodes entities', () => {
    expect(extractXmlValue('<title>Hi &amp; Bye</title>', 'title')).toBe('Hi &amp; Bye')
    expect(decodeHtmlEntities('a &lt;b&gt; &amp; c &#65;')).toBe('a <b> & c A')
    expect(extractXmlAttribute('<img aeskey="abc" md5="d1"/>', 'img', 'md5')).toBe('d1')
    expect(extractXmlValue('<a><![CDATA[ raw ]]></a>', 'a')).toBe('raw')
  })
})

describe('stripSenderPrefix', () => {
  it('removes a group sender prefix but not urls', () => {
    expect(stripSenderPrefix('wxid_abc:\nhello')).toBe('hello')
    expect(stripSenderPrefix('zhang-san_88:\nhello')).toBe('hello')
    expect(stripSenderPrefix('https://x.com')).toBe('https://x.com')
  })
  it('leaves direct-message text that only contains a colon untouched', () => {
    expect(stripSenderPrefix('10:30 开会')).toBe('10:30 开会')
    expect(stripSenderPrefix('Note: bring the keys')).toBe('Note: bring the keys')
    expect(stripSenderPrefix('TODO:买菜')).toBe('TODO:买菜')
  })
})

describe('binary content', () => {
  it('inflates zstd frames', () => {
    const compressed = zstdCompressSync(Buffer.from('你好 world'))
    expect(decodeBinaryContent(compressed)).toBe('你好 world')
  })
  it('decodeMaybeCompressed leaves short strings alone', () => {
    expect(decodeMaybeCompressed('123456')).toBe('123456')
    expect(decodeMaybeCompressed('hello world')).toBe('hello world')
  })
  it('decodeMaybeCompressed never reinterprets text that only looks like hex or base64', () => {
    expect(decodeMaybeCompressed('110101199003074514')).toBe('110101199003074514')
    expect(decodeMaybeCompressed('3f786a1b2c3d4e5f60718293a4b5c6d7')).toBe('3f786a1b2c3d4e5f60718293a4b5c6d7')
    expect(decodeMaybeCompressed('QWxpY2VCb2JDYXJvbA==')).toBe('QWxpY2VCb2JDYXJvbA==')
  })
  it('decodeMaybeCompressed still inflates a hex or base64 spelled zstd frame', () => {
    const frame = zstdCompressSync(Buffer.from('压缩的正文 body'))
    expect(decodeMaybeCompressed(frame.toString('hex'))).toBe('压缩的正文 body')
    expect(decodeMaybeCompressed(frame.toString('base64'))).toBe('压缩的正文 body')
  })
  it('decodeMessageContent prefers compress_content', () => {
    const compressed = zstdCompressSync(Buffer.from('compressed body'))
    expect(decodeMessageContent('plain', compressed)).toBe('compressed body')
    expect(decodeMessageContent('plain', null)).toBe('plain')
  })
})

describe('predicates', () => {
  it('detects hex and wxid', () => {
    expect(looksLikeHex('deadbeef')).toBe(true)
    expect(looksLikeHex('xyz')).toBe(false)
    expect(looksLikeWxid('wxid_abc123')).toBe(true)
    expect(looksLikeWxid('random')).toBe(false)
  })
})

describe('readProtoVarint', () => {
  it('reads single and multi-byte varints', () => {
    expect(readProtoVarint(Buffer.from([0x08]), 0)).toEqual({ value: 8, next: 1 })
    expect(readProtoVarint(Buffer.from([0xac, 0x02]), 0)).toEqual({ value: 300, next: 2 })
  })
})
