import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptEmoticon, deriveEmoticonKey } from './decryptEmoticon'

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
describe('local emoticon decryption', () => {
  it('uses binary MD5 and CBC with key as IV, including wxgf payloads', () => {
    const key = deriveEmoticonKey(123456789, 'wxid_fixture')
    expect(key.length).toBe(16)
    for (const plain of [gif, Buffer.concat([Buffer.from('wxgf'), Buffer.alloc(80)])]) {
      const cipher = createCipheriv('aes-128-cbc', key, key)
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
      expect(decryptEmoticon(encrypted, [Buffer.alloc(16), key])).toEqual(plain)
      expect(decryptEmoticon(encrypted, [Buffer.alloc(16)])).toBeUndefined()
      expect(decryptEmoticon(encrypted.subarray(1), [key])).toBeUndefined()
    }
  })
  it('accepts plain caches and rejects encrypted or arbitrary bytes', () => {
    expect(decryptEmoticon(gif, [])).toEqual(gif)
    expect(decryptEmoticon(Buffer.alloc(32), [])).toBeUndefined()
  })
})
