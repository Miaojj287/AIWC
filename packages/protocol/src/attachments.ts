/**
 * Composer attachments: the limits every layer enforces (the composer shows them inline, the IPC guard rejects
 * anything past them, the kernel bounds what reaches the model) and the pure helpers they share. Attachments travel
 * as `image` / `file` ContentParts with base64 data, so sizes here are decoded bytes.
 */
import type { ContentPart, Mention } from './history'

/** An attachment as it sits in a UserInput. */
export type AttachmentPart = Extract<ContentPart, { type: 'image' | 'file' }>

/** At most this many images / files in one message. */
export const MAX_ATTACHMENTS = 8
/** One image (the strictest provider limit — Anthropic rejects images over 5 MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** One non-image file. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** All attachments of one message together. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024

/** A paste at least this long (characters) becomes a text attachment instead of filling the input. */
export const LONG_PASTE_CHARS = 4_000
/** …or one with at least this many lines. */
export const LONG_PASTE_LINES = 80

/** Characters of a text attachment the model receives; the rest is cut with a marker. */
export const MAX_TEXT_ATTACHMENT_CHARS = 100_000

/** Image types every supported provider accepts inline. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'sh',
  'sql',
])

/** Decoded size of base64 data (padding aware; whitespace is not expected). */
export function base64ByteLength(data: string): number {
  if (!data) return 0
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

const extensionOf = (name: string | undefined): string => {
  const dot = name?.lastIndexOf('.') ?? -1
  return dot >= 0 && name ? name.slice(dot + 1).toLowerCase() : ''
}

/** Text the model can read as-is: `text/*`, JSON / XML / YAML types, or a known source / data extension. */
export function isTextAttachment(mediaType: string, name?: string): boolean {
  const type = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (type.startsWith('text/')) return true
  if (/^application\/(json|xml|x-yaml|yaml|toml|javascript|x-sh|sql|ld\+json|x-ndjson)$/.test(type)) return true
  return TEXT_EXTENSIONS.has(extensionOf(name))
}

export const isImageMediaType = (mediaType: string): boolean =>
  (IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType.toLowerCase())

export const isPdfAttachment = (mediaType: string, name?: string): boolean =>
  mediaType.toLowerCase() === 'application/pdf' || extensionOf(name) === 'pdf'

/** Why a set of attachments is not acceptable; stable codes, the UI words them. */
export type AttachmentViolation =
  | { code: 'too_many'; max: number }
  | { code: 'image_too_large'; name: string; max: number }
  | { code: 'file_too_large'; name: string; max: number }
  | { code: 'total_too_large'; max: number }
  | { code: 'unsupported_type'; name: string }

/** Per-part limit for this attachment. */
export const attachmentMaxBytes = (part: Pick<AttachmentPart, 'type'>): number =>
  part.type === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES

/** First rule the attachments of one message break, or undefined when they are all within limits. */
export function checkAttachments(parts: readonly AttachmentPart[]): AttachmentViolation | undefined {
  if (parts.length > MAX_ATTACHMENTS) return { code: 'too_many', max: MAX_ATTACHMENTS }
  let total = 0
  for (const part of parts) {
    const bytes = base64ByteLength(part.data)
    const name = part.name ?? part.mediaType
    if (part.type === 'image' && !isImageMediaType(part.mediaType)) return { code: 'unsupported_type', name }
    if (bytes > attachmentMaxBytes(part))
      return part.type === 'image'
        ? { code: 'image_too_large', name, max: MAX_IMAGE_BYTES }
        : { code: 'file_too_large', name, max: MAX_FILE_BYTES }
    total += bytes
  }
  return total > MAX_ATTACHMENT_TOTAL_BYTES ? { code: 'total_too_large', max: MAX_ATTACHMENT_TOTAL_BYTES } : undefined
}

/** A paste long enough to become a text attachment. */
export function isLongPaste(text: string): boolean {
  if (text.length >= LONG_PASTE_CHARS) return true
  let lines = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10 && ++lines >= LONG_PASTE_LINES) return true
  return false
}

/** One attachment of a composer draft: the part the message will carry, plus how it was made. */
export interface DraftAttachment {
  /** Local id (chip key); not sent to the kernel. */
  id: string
  part: AttachmentPart
  /** Set when a long paste became this text attachment: its size for the chip. */
  pasted?: { chars: number; lines: number }
}

/** Draft key of a conversation that has no kernel thread yet (the empty new thread / scratch slot). */
export const NEW_THREAD_DRAFT_KEY = 'new'

/** An unsent composer draft kept across restarts (composer:saveDraft). */
export interface ComposerDraftRecord {
  text: string
  mentions: Mention[]
  attachments: DraftAttachment[]
}
