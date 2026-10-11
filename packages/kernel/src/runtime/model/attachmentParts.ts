/**
 * User attachments → model message parts. History keeps what the user attached (base64 image / file parts); what a
 * model receives depends on what it can read:
 *  - images go as images to a model that sees, otherwise as a one-line note (sending them would be rejected);
 *  - text files are decoded and inlined, bounded by MAX_TEXT_ATTACHMENT_CHARS (most chat endpoints reject text/plain
 *    file parts, and the text is what the model needs anyway);
 *  - PDFs go as file parts (the providers that read documents accept them);
 *  - any other binary becomes a note naming the file, so the model can say it cannot open it.
 * The token estimate (estimateAttachmentTokens) follows the same rules, so the context ring matches what is sent.
 */
import {
  base64ByteLength,
  isPdfAttachment,
  isTextAttachment,
  MAX_TEXT_ATTACHMENT_CHARS,
  type AttachmentPart,
} from '@aiwc/protocol'
import type { UserModelMessage } from 'ai'
import { truncateChars } from '../util/truncate'

type UserPart = Exclude<UserModelMessage['content'], string>[number]

/** Rough cost of one image in the prompt (providers bill 1–2k tokens for a typical screenshot). */
const IMAGE_TOKENS = 1_200
const TEXT_BYTES_PER_TOKEN = 3
/** PDFs: about one token per 40 bytes (a 1 MB, ~20 page document ≈ 25k tokens), at least one image's worth. */
const PDF_BYTES_PER_TOKEN = 40

const quoteAttr = (value: string): string => value.replace(/[\r\n"<>]/g, ' ')

const decodeText = (data: string): string => Buffer.from(data, 'base64').toString('utf8')

/** Inline form of a text attachment: the file's text between tags that name it. */
export function textAttachmentBlock(name: string, mediaType: string, data: string): string {
  const { text } = truncateChars(decodeText(data), MAX_TEXT_ATTACHMENT_CHARS)
  return `<attached_file name="${quoteAttr(name)}" type="${quoteAttr(mediaType)}">\n${text}\n</attached_file>`
}

export interface AttachmentPartOptions {
  /** The model accepts image input; when false images become a note. Default true. */
  vision?: boolean
}

export function attachmentToModelPart(part: AttachmentPart, opts: AttachmentPartOptions = {}): UserPart {
  const name = part.name ?? part.mediaType
  if (part.type === 'image') {
    if (opts.vision === false)
      return {
        type: 'text',
        text: `[Image "${quoteAttr(name)}" omitted: the selected model does not accept image input.]`,
      }
    return { type: 'image', image: part.data, mediaType: part.mediaType }
  }
  if (isTextAttachment(part.mediaType, part.name))
    return { type: 'text', text: textAttachmentBlock(name, part.mediaType, part.data) }
  if (isPdfAttachment(part.mediaType, part.name))
    return { type: 'file', data: part.data, mediaType: 'application/pdf', filename: part.name }
  const kb = Math.ceil(base64ByteLength(part.data) / 1024)
  return {
    type: 'text',
    text: `[Attached file "${quoteAttr(name)}" (${quoteAttr(part.mediaType)}, ${kb} KB) cannot be read as text.]`,
  }
}

/**
 * Token estimate of one attachment as the model will see it. Computed from the size alone (it runs on every usage
 * update): about three UTF-8 bytes per token for text, which sits between English (~4) and Chinese (~3 per char).
 */
export function estimateAttachmentTokens(part: AttachmentPart): number {
  if (part.type === 'image') return IMAGE_TOKENS
  const bytes = base64ByteLength(part.data)
  if (isTextAttachment(part.mediaType, part.name))
    return Math.ceil(Math.min(bytes, MAX_TEXT_ATTACHMENT_CHARS * TEXT_BYTES_PER_TOKEN) / TEXT_BYTES_PER_TOKEN) + 16
  if (isPdfAttachment(part.mediaType, part.name)) return Math.max(IMAGE_TOKENS, Math.ceil(bytes / PDF_BYTES_PER_TOKEN))
  return 32
}
