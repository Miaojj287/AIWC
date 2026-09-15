import { createDecipheriv, createHash } from 'node:crypto'
import { detectImageExtension, isWxgf } from './datDecryptCore'

/** Local emoticon storage uses the binary MD5 digest, not the CDN AES key or image key. */
export function deriveEmoticonKey(uin: number, wxid: string): Buffer {
  return createHash('md5').update(`${uin}${wxid}EMOTICON`).digest()
}

export function decryptEmoticon(data: Buffer, keys: readonly Buffer[]): Buffer | undefined {
  if (isWxgf(data) || detectImageExtension(data)) return data
  if (!data.length || data.length % 16 !== 0) return undefined
  for (const key of keys) {
    try {
      const cipher = createDecipheriv('aes-128-cbc', key, key)
      const plain = Buffer.concat([cipher.update(data), cipher.final()])
      if (isWxgf(plain) || detectImageExtension(plain)) return plain
    } catch {
      /* Another account's UIN, or an incomplete cache file. */
    }
  }
  return undefined
}
