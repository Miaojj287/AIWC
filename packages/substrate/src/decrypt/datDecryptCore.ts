/**
 * Pure-TypeScript decryption of WeChat `.dat` image files.
 *  - V3 (no header): whole file XOR'ed with a one-byte key (plaintext files also occur).
 *  - V4 (`07 08 56 31|32 08 07` header): AES-128-ECB(PKCS7) prefix + raw middle + XOR'ed tail.
 *    V1 uses the fixed key "cfcd208495d565ef"; V2 uses the per-account key.
 * Buffer-in / buffer-out so tests run on synthetic data. Shared with the native addon fallback path.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto'

export const DEFAULT_V1_AES_KEY = 'cfcd208495d565ef'
export const DAT_V4_HEADER_SIZE = 0x0f

const V1_SIGNATURE = Buffer.from([0x07, 0x08, 0x56, 0x31, 0x08, 0x07])
const V2_SIGNATURE = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])

export type DatVersion = 0 | 1 | 2

export function getDatVersion(bytes: Buffer): DatVersion {
  if (bytes.length < 6) return 0
  const signature = bytes.subarray(0, 6)
  if (signature.equals(V1_SIGNATURE)) return 1
  if (signature.equals(V2_SIGNATURE)) return 2
  return 0
}

/** 16 ASCII bytes from a key string (V4 AES key is an ASCII token, not hex). */
export function asciiKey16(keyString: string): Buffer {
  if (keyString.length < 16) throw new Error('AES 密钥至少需要 16 个字符')
  return Buffer.from(keyString, 'ascii').subarray(0, 16)
}

/** Accept 16 ASCII chars, 32 hex chars, or a 16-byte buffer. */
export function normalizeAesKey(key: string | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(key) || key instanceof Uint8Array) {
    const buf = Buffer.from(key)
    if (buf.length !== 16) throw new Error('AES 密钥必须是 16 字节')
    return buf
  }
  const trimmed = String(key).trim()
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return Buffer.from(trimmed, 'hex')
  return asciiKey16(trimmed)
}

/** Accept a number, "0x73", "73" or "115". */
export function normalizeXorKey(key: number | string): number {
  if (typeof key === 'number') {
    if (!Number.isInteger(key) || key < 0 || key > 0xff) throw new Error('XOR 密钥必须是 0-255 的整数')
    return key
  }
  const trimmed = String(key).trim()
  if (/^0x[0-9a-fA-F]{1,2}$/i.test(trimmed)) return Number.parseInt(trimmed.slice(2), 16)
  if (/^[0-9a-fA-F]{2}$/.test(trimmed) && !/^\d{2}$/.test(trimmed)) return Number.parseInt(trimmed, 16)
  if (/^\d{1,3}$/.test(trimmed)) {
    const dec = Number.parseInt(trimmed, 10)
    if (dec <= 0xff) return dec
  }
  if (/^[0-9a-fA-F]{2}$/.test(trimmed)) return Number.parseInt(trimmed, 16)
  throw new Error(`无法解析 XOR 密钥: ${trimmed}`)
}

export function stripTrailingNulBytes(data: Buffer): Buffer {
  let end = data.length
  while (end > 0 && data[end - 1] === 0x00) end -= 1
  return end === data.length ? data : data.subarray(0, end)
}

function detectImageExtensionAt(buffer: Buffer, offset: number): string | null {
  if (buffer.length < offset + 12) return null
  const b = (i: number) => buffer[offset + i] ?? -1
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return '.gif'
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return '.png'
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return '.jpg'
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return '.webp'
  if (b(0) === 0x42 && b(1) === 0x4d) return '.bmp'
  return null
}

export function isWxgf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x77 && buffer[1] === 0x78 && buffer[2] === 0x67 && buffer[3] === 0x66
}

/** Sniff the image type; for WeChat's `wxgf` container, look for an embedded signature. */
export function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  if (isWxgf(buffer)) {
    for (const offset of [0x10, 0x12, 0x14, 0x18, 0x20, 0xd0, 0x100]) {
      const ext = detectImageExtensionAt(buffer, offset)
      if (ext) return ext
    }
    for (let i = 4; i < Math.min(buffer.length - 3, 512); i++) {
      if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) return '.jpg'
    }
    return null
  }
  return detectImageExtensionAt(buffer, 0)
}

function xorBuffer(data: Buffer, xorKey: number): Buffer {
  const out = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i] ?? 0) ^ xorKey
  return out
}

/**
 * Guess the XOR key of a V3 file from the first two bytes against known image signatures.
 * Returns null when no candidate is self-consistent.
 */
export function guessXorKey(data: Buffer): number | null {
  if (data.length < 4) return null
  const b0 = data[0] ?? 0
  const b1 = data[1] ?? 0
  const b2 = data[2] ?? 0
  const b3 = data[3] ?? 0
  const candidates: Array<[number, number, number, number | null]> = [
    [0xff, 0xd8, 0xff, null], // jpg
    [0x89, 0x50, 0x4e, 0x47], // png
    [0x47, 0x49, 0x46, 0x38], // gif
    [0x52, 0x49, 0x46, 0x46], // riff/webp
    [0x42, 0x4d, -1, null], // bmp (only two bytes)
  ]
  for (const [s0, s1, s2, s3] of candidates) {
    const key = b0 ^ s0
    if ((b1 ^ key) !== s1) continue
    if (s2 >= 0 && (b2 ^ key) !== s2) continue
    if (s3 !== null && (b3 ^ key) !== s3) continue
    return key
  }
  return null
}

/** V3: plaintext passthrough (trailing NULs trimmed) or XOR with `xorKey` (guessed when omitted). */
export function decryptDatV3(data: Buffer, xorKey: number | null | undefined): Buffer {
  if (detectImageExtension(data)) return stripTrailingNulBytes(data)
  const key = xorKey ?? guessXorKey(data)
  if (key === null || key === undefined) throw new Error('缺少图片 XOR 密钥，且无法从文件头推断')
  return xorBuffer(data, key)
}

function bytesToInt32LE(bytes: Buffer): number {
  return bytes.readInt32LE(0)
}

function strictRemovePadding(data: Buffer): Buffer {
  if (!data.length) throw new Error('解密结果为空，填充非法')
  const paddingLength = data[data.length - 1] ?? 0
  if (paddingLength === 0 || paddingLength > 16 || paddingLength > data.length) throw new Error('PKCS7 填充长度非法（AES 密钥可能不正确）')
  for (let i = data.length - paddingLength; i < data.length; i += 1) {
    if (data[i] !== paddingLength) throw new Error('PKCS7 填充内容非法（AES 密钥可能不正确）')
  }
  return data.subarray(0, data.length - paddingLength)
}

/** V4 layout: [15-byte header][AES block(s)][raw bytes][XOR'ed tail]. */
export function decryptDatV4(bytes: Buffer, xorKey: number, aesKey: Buffer): Buffer {
  if (bytes.length < DAT_V4_HEADER_SIZE) throw new Error('文件太小，无法解析')
  const header = bytes.subarray(0, DAT_V4_HEADER_SIZE)
  const data = bytes.subarray(DAT_V4_HEADER_SIZE)
  const aesSize = bytesToInt32LE(header.subarray(6, 10))
  const xorSize = bytesToInt32LE(header.subarray(10, 14))
  if (aesSize < 0) throw new Error('文件格式异常：AES 数据长度非法')

  const remainder = aesSize % 16
  const alignedAesSize = aesSize + (16 - remainder)
  if (alignedAesSize > data.length) throw new Error('文件格式异常：AES 数据长度超过文件实际长度')

  let unpadded: Buffer = Buffer.alloc(0)
  const aesData = data.subarray(0, alignedAesSize)
  if (aesData.length > 0) {
    const decipher = createDecipheriv('aes-128-ecb', aesKey, null)
    decipher.setAutoPadding(false)
    unpadded = strictRemovePadding(Buffer.concat([decipher.update(aesData), decipher.final()]))
  }

  const remaining = data.subarray(alignedAesSize)
  if (xorSize < 0 || xorSize > remaining.length) throw new Error('文件格式异常：XOR 数据长度不合法')
  if (xorSize === 0) return Buffer.concat([unpadded, remaining])
  const rawLength = remaining.length - xorSize
  const rawData = remaining.subarray(0, rawLength)
  const xored = xorBuffer(remaining.subarray(rawLength), xorKey)
  return Buffer.concat([unpadded, rawData, xored])
}

export interface DatDecryptOptions {
  xorKey?: number | null
  aesKey?: Buffer | null
}

export interface DatDecryptOutput {
  data: Buffer
  version: DatVersion
  ext: string | null
  wxgf: boolean
}

/** Decrypt any `.dat` buffer, choosing the algorithm by header. */
export function decryptDatBuffer(bytes: Buffer, opts: DatDecryptOptions = {}): DatDecryptOutput {
  const version = getDatVersion(bytes)
  let data: Buffer
  if (version === 0) {
    data = decryptDatV3(bytes, opts.xorKey)
  } else {
    if (opts.xorKey === null || opts.xorKey === undefined) throw new Error('缺少图片 XOR 密钥')
    const aesKey = version === 1 ? asciiKey16(DEFAULT_V1_AES_KEY) : opts.aesKey
    if (!aesKey || aesKey.length !== 16) throw new Error('缺少图片 AES 密钥，请先在设置中获取')
    data = decryptDatV4(bytes, opts.xorKey, aesKey)
  }
  return { data, version, ext: detectImageExtension(data), wxgf: isWxgf(data) }
}

/** Build a V2 `.dat` from plaintext (tests and fixtures). */
export function encryptDatV4(plain: Buffer, xorKey: number, aesKey: Buffer, aesPortion = 1024): Buffer {
  const aesSize = Math.min(aesPortion, plain.length)
  const cipher = createCipheriv('aes-128-ecb', aesKey, null)
  cipher.setAutoPadding(true)
  const aesBlock = Buffer.concat([cipher.update(plain.subarray(0, aesSize)), cipher.final()])
  const rest = plain.subarray(aesSize)
  const xorSize = Math.min(rest.length, 1024)
  const raw = rest.subarray(0, rest.length - xorSize)
  const xored = xorBuffer(rest.subarray(rest.length - xorSize), xorKey)
  const header = Buffer.alloc(DAT_V4_HEADER_SIZE)
  V2_SIGNATURE.copy(header, 0)
  header.writeInt32LE(aesSize, 6)
  header.writeInt32LE(xorSize, 10)
  return Buffer.concat([header, aesBlock, raw, xored])
}
