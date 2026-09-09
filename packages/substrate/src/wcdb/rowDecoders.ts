/**
 * Row-level decoders shared by every WCDB query: loose numeric/string coercion, blob decoding,
 * zstd-compressed message bodies, and tiny XML helpers (WeChat stores rich messages as XML).
 * Pure functions — no I/O, no native code — so they are fully unit-testable.
 */
import { decompress } from 'fzstd'

export type Row = Record<string, unknown>

const ZSTD_MAGIC = 0xfd2fb528

export function coerceRowNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  const text = String(value).trim()
  if (!text) return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function coerceRowString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (Buffer.isBuffer(value)) return value.toString('utf8') || undefined
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8') || undefined
  const text = String(value).trim()
  return text || undefined
}

/** Field lookup tolerant to column naming differences across WeChat versions (case-insensitive). */
export function getRowField(row: Row, fieldNames: readonly string[]): unknown {
  for (const name of fieldNames) {
    const direct = row[name]
    if (direct !== undefined && direct !== null) return direct
  }
  const lower = new Map<string, string>()
  for (const actual of Object.keys(row)) lower.set(actual.toLowerCase(), actual)
  for (const name of fieldNames) {
    const actual = lower.get(name.toLowerCase())
    if (actual !== undefined) {
      const value = row[actual]
      if (value !== undefined && value !== null) return value
    }
  }
  return undefined
}

/** Decode a BLOB column that may arrive as Buffer, Uint8Array, number[], hex or base64 text. */
export function decodeBlob(raw: unknown): Buffer | null {
  if (!raw) return null
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  if (Array.isArray(raw)) return Buffer.from(raw as number[])
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    if (looksLikeHex(trimmed)) return Buffer.from(trimmed, 'hex')
    try {
      return Buffer.from(trimmed, 'base64')
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') {
    const data = (raw as { data?: unknown }).data
    if (Array.isArray(data)) return Buffer.from(data as number[])
  }
  return null
}

export function extractXmlAttribute(xml: string, tagName: string, attrName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*\\s${attrName}\\s*=\\s*['"]([^'"]*)['"]`, 'i')
  const match = regex.exec(xml)
  return match?.[1] ?? ''
}

export function extractXmlValue(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i')
  const match = regex.exec(xml)
  if (!match) return ''
  return (match[1] ?? '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
}

export function decodeHtmlEntities(content: string): string {
  const decodeCodePoint = (value: string, radix: 10 | 16, fallback: string): string => {
    const codePoint = Number.parseInt(value, radix)
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return fallback
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return fallback
    }
  }
  return String(content || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (entity, hex: string) => decodeCodePoint(hex, 16, entity))
    .replace(/&#(\d+);/g, (entity, dec: string) => decodeCodePoint(dec, 10, entity))
    .replace(/&amp;/g, '&')
}

/** Remove control characters that leak out of binary-ish columns. */
export function cleanString(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const isControl =
      code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)
    if (!isControl) out += text[i]
  }
  return out
}

export function cleanSystemMessage(content: string): string {
  let cleaned = content.replace(/<\?xml[^?]*\?>/gi, '')
  cleaned = cleaned.replace(/<[^>]+>/g, '')
  cleaned = cleaned.replace(/\d+\s*$/, '')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned || '[系统消息]'
}

/** Group text messages are stored as `wxid_xxx:\ntext`; strip the sender prefix. */
export function stripSenderPrefix(content: string): string {
  return content.replace(/^[\s]*([a-zA-Z0-9_@.-]+):(?!\/\/)\s*/, '')
}

export function looksLikeHex(s: string): boolean {
  return s.length % 2 === 0 && s.length > 0 && /^[0-9a-fA-F]+$/.test(s)
}

export function looksLikeBase64(s: string): boolean {
  return s.length % 4 === 0 && s.length > 0 && /^[A-Za-z0-9+/=]+$/.test(s)
}

export function looksLikeWxid(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim().toLowerCase()
  if (trimmed.startsWith('wxid_')) return true
  return /^wx[a-z0-9_-]{4,}$/.test(trimmed)
}

/** Decode a binary body: zstd frame → UTF-8; otherwise UTF-8 with latin1 fallback. */
export function decodeBinaryContent(data: Buffer): string {
  if (data.length === 0) return ''
  try {
    if (data.length >= 4 && data.readUInt32LE(0) === ZSTD_MAGIC) {
      try {
        return Buffer.from(decompress(data)).toString('utf8')
      } catch {
        // fall through to plain decoding
      }
    }
    const decoded = data.toString('utf8')
    const replacementCount = (decoded.match(/�/g) || []).length
    if (replacementCount < decoded.length * 0.2) return decoded.replace(/�/g, '')
    return data.toString('latin1')
  } catch {
    return ''
  }
}

/**
 * Decode a column that may be a Buffer, a hex/base64 encoded blob or plain text.
 * Short strings (≤16 chars) are never treated as encodings — "123456" is text, not hex.
 */
export function decodeMaybeCompressed(raw: unknown): string {
  if (!raw) return ''
  if (Buffer.isBuffer(raw)) return decodeBinaryContent(raw)
  if (raw instanceof Uint8Array) return decodeBinaryContent(Buffer.from(raw))
  if (typeof raw !== 'string') return ''
  if (raw.length === 0) return ''
  if (raw.length > 16 && looksLikeHex(raw)) {
    const bytes = Buffer.from(raw, 'hex')
    if (bytes.length > 0) return decodeBinaryContent(bytes)
  }
  if (raw.length > 16 && looksLikeBase64(raw)) {
    try {
      return decodeBinaryContent(Buffer.from(raw, 'base64'))
    } catch {
      // not base64 after all
    }
  }
  return raw
}

/** compress_content wins over message_content when present (WeChat 4.x zstd-compresses long bodies). */
export function decodeMessageContent(messageContent: unknown, compressContent: unknown): string {
  const compressed = decodeMaybeCompressed(compressContent)
  if (compressed) return compressed
  return decodeMaybeCompressed(messageContent)
}

/** Read a protobuf varint (used for contact extra_buffer parsing). */
export function readProtoVarint(data: Buffer, start: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  for (let offset = start; offset < data.length && shift <= 28; offset++) {
    const byte = data[offset] ?? 0
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, next: offset + 1 }
    shift += 7
  }
  return null
}
