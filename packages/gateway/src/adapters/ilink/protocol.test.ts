import { describe, expect, it } from 'vitest'
import updates from './fixtures/updates.json'
import { buildClientVersion, incomingKind, incomingText, isSessionExpiredError, messageKey, messageTimestamp, parseIncomingMessage, type IlinkMessage } from './protocol'
import { chunkText, shapeOutboundText, splitExplicitBubbles } from './textSplit'
import { aesEcbPaddedSize, decodeIncomingBuffer, decryptAesEcb, detectMediaType, encryptAesEcb, normalizeAesKey } from './media'

const msgs = updates.msgs as IlinkMessage[]

describe('iLink protocol parsing', () => {
  it('parses a text message', () => {
    const parsed = parseIncomingMessage(msgs[0]!)
    expect(parsed.textSegments).toEqual(['你好，报价单能发一下吗'])
    expect(parsed.attachments).toEqual([])
    expect(incomingKind(parsed)).toBe('text')
    expect(incomingText(parsed)).toBe('你好，报价单能发一下吗')
  })

  it('parses a voice message with transcript and unescapes the CDN url', () => {
    const parsed = parseIncomingMessage(msgs[1]!)
    expect(parsed.voiceTranscript).toBe('下午三点开会')
    expect(parsed.attachments[0]).toMatchObject({ kind: 'voice', url: 'https://cdn.example/voice1?x=1&y=2', aesKey: '00112233445566778899aabbccddeeff' })
    expect(incomingKind(parsed)).toBe('voice')
    expect(incomingText(parsed)).toBe('[语音] 下午三点开会')
  })

  it('parses mixed image + text keeping text dominant', () => {
    const parsed = parseIncomingMessage(msgs[2]!)
    expect(parsed.textSegments).toEqual(['看看这张图'])
    expect(parsed.attachments[0]).toMatchObject({ kind: 'image', mediaType: 'image/jpeg', sizeBytes: 2048, url: 'https://cdn.example/img1' })
    expect(incomingKind(parsed)).toBe('text')
    expect(incomingText(parsed)).toBe('看看这张图\n[图片]')
  })

  it('parses a file with name / size / guessed media type', () => {
    const parsed = parseIncomingMessage(msgs[3]!)
    expect(parsed.attachments[0]).toMatchObject({ kind: 'file', filename: '合同.pdf', mediaType: 'application/pdf', sizeBytes: 12345 })
    expect(incomingKind(parsed)).toBe('file')
    expect(incomingText(parsed)).toBe('[文件] 合同.pdf')
  })

  it('ignores unknown item types and empty messages', () => {
    const parsed = parseIncomingMessage({ item_list: [{ type: 99 }, { type: 1, text_item: { text: '   ' } }] })
    expect(parsed.textSegments).toEqual([])
    expect(parsed.attachments).toEqual([])
    expect(incomingText(parsed)).toBe('')
  })

  it('builds dedupe keys from explicit ids or a content hash', () => {
    expect(messageKey(msgs[0]!)).toBe('id:1001')
    const noId = msgs[2]!
    const k1 = messageKey(noId)
    const k2 = messageKey({ ...noId, item_list: [...(noId.item_list ?? [])] })
    expect(k1).toBe(k2)
    expect(k1.startsWith('h:')).toBe(true)
    expect(messageKey({ ...noId, context_token: 'other' })).not.toBe(k1)
  })

  it('derives millisecond timestamps from seconds / ms / fallback', () => {
    expect(messageTimestamp(msgs[0]!, 1)).toBe(1757100000_000)
    expect(messageTimestamp(msgs[1]!, 1)).toBe(1757100001500)
    expect(messageTimestamp(msgs[2]!, 42)).toBe(42)
  })

  it('recognises the session-expired error and computes the client version header', () => {
    expect(isSessionExpiredError(new Error('ret -14 session timeout'))).toBe(true)
    expect(isSessionExpiredError(new Error('HTTP 500'))).toBe(false)
    expect(buildClientVersion('2.4.4')).toBe((2 << 16) | (4 << 8) | 4)
  })
})

describe('outbound text shaping', () => {
  it('splits on the ---wx-next--- separator', () => {
    expect(splitExplicitBubbles('第一条\n---wx-next---\n第二条\n\n---wx-next---\n')).toEqual(['第一条', '第二条'])
    expect(splitExplicitBubbles('no separator')).toEqual(['no separator'])
    // The marker must never survive into a bubble: a contact receiving '---wx-next---' is the bug.
    expect(splitExplicitBubbles('想吃什么？ ---wx-next--- 先垫垫')).toEqual(['想吃什么？', '先垫垫'])
    expect(splitExplicitBubbles('第一条--wx-next--第二条')).toEqual(['第一条', '第二条'])
    expect(splitExplicitBubbles('第一条\n-----wx-next-----\n第二条')).toEqual(['第一条', '第二条'])
    expect(splitExplicitBubbles('只有分隔符 ---wx-next---')).toEqual(['只有分隔符'])
    expect(splitExplicitBubbles('---WX-NEXT---')).toEqual([])
    // A lone dash run is ordinary text, not a separator
    expect(splitExplicitBubbles('分割线 --- 后面')).toEqual(['分割线 --- 后面'])
  })

  it('chunks long text at newline / punctuation boundaries within the limit', () => {
    const para = '这是一句话。'.repeat(100) // 600 chars
    const chunks = chunkText(para, 250)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(Array.from(c).length).toBeLessThanOrEqual(250)
    for (const c of chunks) expect(c.endsWith('。')).toBe(true)
    expect(chunks.join('')).toBe(para)
  })

  it('falls back to hard cuts without any separator characters', () => {
    const chunks = chunkText('x'.repeat(10_001), 4000)
    expect(chunks.map((c) => c.length)).toEqual([4000, 4000, 2001])
  })

  it('shapeOutboundText combines both', () => {
    expect(shapeOutboundText(`${'a'.repeat(5)}\n---wx-next---\n${'b'.repeat(9)}`, 4)).toEqual(['aaaa', 'a', 'bbbb', 'bbbb', 'b'])
    expect(shapeOutboundText('')).toEqual([])
  })
})

describe('media crypto helpers', () => {
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex')

  it('AES-128-ECB round-trips with PKCS#7 padding', () => {
    const plain = Buffer.from('hello wechat cdn')
    const enc = encryptAesEcb(plain, key)
    expect(enc.length).toBe(aesEcbPaddedSize(plain.length))
    expect(decryptAesEcb(enc, key)?.toString()).toBe('hello wechat cdn')
    expect(decryptAesEcb(Buffer.from('short'), key)).toBeNull()
  })

  it('normalises hex / base64(hex) / base64(raw) keys', () => {
    expect(normalizeAesKey('00112233445566778899aabbccddeeff')?.equals(key)).toBe(true)
    expect(normalizeAesKey(Buffer.from('00112233445566778899aabbccddeeff').toString('base64'))?.equals(key)).toBe(true)
    expect(normalizeAesKey(key.toString('base64'))?.equals(key)).toBe(true)
    expect(normalizeAesKey('')).toBeNull()
    expect(normalizeAesKey('zz')).toBeNull()
  })

  it('detects containers by magic bytes', () => {
    expect(detectMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(detectMediaType(Buffer.from('%PDF-1.4'))).toBe('application/pdf')
    expect(detectMediaType(Buffer.from('#!SILK_V3xxxx'))).toBe('audio/silk')
    expect(detectMediaType(Buffer.from('nope'))).toBeNull()
  })

  it('decrypts an encrypted image payload and leaves plaintext alone', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpegdata')])
    const attachment = { kind: 'image' as const, filename: 'a.jpg', mediaType: 'image/jpeg', aesKey: key.toString('hex') }
    expect(decodeIncomingBuffer(encryptAesEcb(jpeg, key), attachment).equals(jpeg)).toBe(true)
    expect(decodeIncomingBuffer(jpeg, attachment).equals(jpeg)).toBe(true)
    expect(decodeIncomingBuffer(jpeg, { ...attachment, aesKey: undefined }).equals(jpeg)).toBe(true)
  })
})
