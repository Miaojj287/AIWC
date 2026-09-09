/**
 * iLink CDN media: AES-128-ECB (PKCS#7) at rest, plain HTTPS in flight. Download side decrypts to
 * stateDir/media; upload side encrypts before POSTing to the CDN. Both accept an injectable fetch.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { IlinkAttachment } from './protocol'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const MEDIA_LIMITS = {
  image: 20 * 1024 * 1024,
  file: 100 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  voice: 10 * 1024 * 1024,
  /** Inbound cap: anything larger is left on the CDN and only described to the model. */
  inbound: 32 * 1024 * 1024,
} as const

export const CDN_UPLOAD_RETRIES = 3
export const DOWNLOAD_TIMEOUT_MS = 15_000

export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16
}

export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer | null {
  try {
    const decipher = createDecipheriv('aes-128-ecb', key, null)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    return null
  }
}

/** The server hands out keys as 32 hex chars, base64(hex) or base64(raw 16 bytes). */
export function normalizeAesKey(value?: string): Buffer | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex')
  try {
    const decoded = Buffer.from(trimmed, 'base64')
    const asText = decoded.toString('utf8').trim()
    if (/^[0-9a-f]{32}$/i.test(asText)) return Buffer.from(asText, 'hex')
    if (decoded.length === 16) return decoded
  } catch {
    return null
  }
  return null
}

export function detectMediaType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4'
  if (buffer.subarray(0, 9).toString('ascii') === '#!SILK_V3') return 'audio/silk'
  if (buffer.subarray(0, 6).toString('ascii') === '#!AMR\n') return 'audio/amr'
  return null
}

function looksMostlyText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let control = 0
  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1
  }
  return control / sample.length < 0.02
}

/** Decrypt when the payload is not already a recognisable plaintext container. */
export function decodeIncomingBuffer(raw: Buffer, attachment: IlinkAttachment): Buffer {
  if (!attachment.aesKey) return raw
  if (detectMediaType(raw)) return raw
  const key = normalizeAesKey(attachment.aesKey)
  if (!key) return raw
  const decrypted = decryptAesEcb(raw, key)
  if (!decrypted) return raw
  if (detectMediaType(decrypted)) return decrypted
  if ((attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json') && looksMostlyText(decrypted)) return decrypted
  if (attachment.kind === 'image' || attachment.kind === 'voice') return decrypted
  return raw
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s-]/g, '_').trim()
  return cleaned || 'file'
}

export interface DownloadedMedia {
  path: string
  mediaType: string
  sizeBytes: number
}

/** Fetch + decrypt an inbound attachment into `dir`; throws with a Chinese reason on failure. */
export async function downloadAttachment(
  fetchImpl: FetchLike,
  attachment: IlinkAttachment,
  dir: string,
  opts: { timeoutMs?: number; maxBytes?: number; id?: string } = {},
): Promise<DownloadedMedia> {
  if (!attachment.url) throw new Error('附件没有下载地址')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS)
  const maxBytes = opts.maxBytes ?? MEDIA_LIMITS.inbound
  try {
    const res = await fetchImpl(attachment.url, { headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 MicroMessenger AIWC' }, signal: controller.signal })
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('附件超过大小上限')
    const raw = Buffer.from(await res.arrayBuffer())
    if (raw.length === 0) throw new Error('下载内容为空')
    if (raw.length > maxBytes) throw new Error('附件超过大小上限')
    const buffer = decodeIncomingBuffer(raw, attachment)
    const detected = detectMediaType(buffer)
    if (attachment.kind === 'image' && !detected?.startsWith('image/')) throw new Error('图片解密失败或格式不支持')
    const mediaType = detected ?? attachment.mediaType
    mkdirSync(dir, { recursive: true })
    const stamp = opts.id ?? `${Date.now()}_${randomBytes(3).toString('hex')}`
    const path = join(dir, `${stamp}_${safeFilename(attachment.filename)}`)
    await writeFile(path, buffer)
    return { path, mediaType, sizeBytes: buffer.length }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('下载超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export interface UploadedMedia {
  filekey: string
  encryptedQueryParam: string
  /** hex */
  aeskey: string
  fileSize: number
  fileSizeCiphertext: number
  rawFileMd5: string
}

export function createFileKey(fileName: string, random: () => Buffer = () => randomBytes(16)): string {
  const ext = extname(fileName).replace(/[^a-z0-9.]/gi, '').slice(0, 16)
  return `${random().toString('hex')}${ext}`
}

export function buildCdnUploadUrl(baseUrl: string, uploadParam: string, filekey: string): string {
  return `${baseUrl.replace(/\/$/, '')}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

export function assertUploadable(filePath: string, maxBytes: number): number {
  if (!existsSync(filePath)) throw new Error(`媒体文件不存在：${basename(filePath)}`)
  const stat = statSync(filePath)
  if (!stat.isFile()) throw new Error('媒体路径不是文件')
  if (stat.size <= 0) throw new Error('媒体文件为空')
  if (stat.size > maxBytes) throw new Error(`媒体文件过大，最大 ${Math.floor(maxBytes / 1024 / 1024)}MB`)
  return stat.size
}

/** Read + encrypt a local file; the caller obtains the upload URL and posts `encrypted`. */
export async function prepareUpload(filePath: string, maxBytes: number, random: () => Buffer = () => randomBytes(16)): Promise<{ plaintext: Buffer; encrypted: Buffer; aeskey: Buffer; filekey: string; rawFileMd5: string }> {
  assertUploadable(filePath, maxBytes)
  const plaintext = await readFile(filePath)
  const aeskey = random()
  const filekey = createFileKey(filePath, random)
  const rawFileMd5 = createHash('md5').update(plaintext).digest('hex')
  return { plaintext, encrypted: encryptAesEcb(plaintext, aeskey), aeskey, filekey, rawFileMd5 }
}

/** POST encrypted bytes to the CDN with retries; 4xx is final. Returns x-encrypted-param. */
export async function uploadEncryptedMedia(fetchImpl: FetchLike, uploadUrl: string, encrypted: Buffer, retries = CDN_UPLOAD_RETRIES): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(encrypted) })
      if (res.status >= 400 && res.status < 500) {
        const detail = res.headers.get('x-error-message') ?? (await res.text().catch(() => ''))
        throw new Error(`CDN 上传被拒绝 ${res.status}: ${detail}`)
      }
      if (res.status !== 200) throw new Error(`CDN 上传失败：${res.headers.get('x-error-message') ?? `status ${res.status}`}`)
      const param = res.headers.get('x-encrypted-param')
      if (!param) throw new Error('CDN 上传响应缺少 x-encrypted-param')
      return param
    } catch (err) {
      lastError = err
      if (err instanceof Error && err.message.includes('被拒绝')) throw err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('CDN 上传失败')
}
