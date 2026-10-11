/**
 * Composer attachments (renderer side): turning pasted / dropped / picked files and long pastes into DraftAttachments,
 * checking them against the shared limits (@aiwc/protocol attachments.ts) before anything is read in full, and the
 * sentence for each problem. Pure apart from reading File objects — tested in attachments.test.ts.
 */
import {
  attachmentMaxBytes,
  base64ByteLength,
  checkAttachments,
  isImageMediaType,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENTS,
  type AttachmentPart,
  type AttachmentViolation,
  type ContentPart,
  type DraftAttachment,
} from '@aiwc/protocol'
import { t } from '@/i18n'
import { formatBytes } from '@/platform/format'

/** Everything that can go wrong adding attachments: a limit (shared code) or a file the browser could not read. */
export type AttachmentProblem = AttachmentViolation | { code: 'read_failed'; name: string }

/** Extension → media type for files the OS hands over without a type (common on Windows and for source files). */
const MEDIA_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
}

let counter = 0
/** Local chip id (never sent to the kernel). */
export const newAttachmentId = (): string => `att_${Date.now().toString(36)}_${(counter++).toString(36)}`

export function mediaTypeOf(file: Pick<File, 'name' | 'type'>): string {
  if (file.type) return file.type.split(';', 1)[0]?.trim().toLowerCase() ?? file.type
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return MEDIA_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

/** Bytes → base64 in chunks (a single String.fromCharCode spread overflows the stack on large files). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

const utf8ToBase64 = (text: string): string => bytesToBase64(new TextEncoder().encode(text))

/** A file's bytes as base64 (FileReader's data: URL, without its prefix). */
function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export const attachmentBytes = (a: DraftAttachment): number => base64ByteLength(a.part.data)

/** `data:` URL for an image attachment's preview (the CSP allows data: images). */
export const imagePreviewUrl = (part: AttachmentPart): string | undefined =>
  part.type === 'image' ? `data:${part.mediaType};base64,${part.data}` : undefined

/**
 * Add files to the existing attachments. Limits are checked from `File.size` before reading, so a huge file is never
 * loaded; the files that fit are added and the first problem is reported for the rest.
 */
export async function addFiles(
  existing: readonly DraftAttachment[],
  files: readonly File[],
): Promise<{ attachments: DraftAttachment[]; problem?: AttachmentProblem }> {
  const out = [...existing]
  let total = existing.reduce((n, a) => n + attachmentBytes(a), 0)
  let problem: AttachmentProblem | undefined
  for (const file of files) {
    const mediaType = mediaTypeOf(file)
    const isImage = mediaType.startsWith('image/')
    if (isImage && !isImageMediaType(mediaType)) {
      problem ??= { code: 'unsupported_type', name: file.name }
      continue
    }
    const type = isImage ? 'image' : 'file'
    if (out.length >= MAX_ATTACHMENTS) {
      problem ??= { code: 'too_many', max: MAX_ATTACHMENTS }
      break
    }
    const max = attachmentMaxBytes({ type })
    if (file.size > max) {
      problem ??= { code: type === 'image' ? 'image_too_large' : 'file_too_large', name: file.name, max }
      continue
    }
    if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
      problem ??= { code: 'total_too_large', max: MAX_ATTACHMENT_TOTAL_BYTES }
      continue
    }
    try {
      const data = await readBase64(file)
      const part: AttachmentPart =
        type === 'image'
          ? { type, mediaType, data, name: file.name || undefined }
          : { type, mediaType, data, name: file.name }
      out.push({ id: newAttachmentId(), part })
      total += file.size
    } catch {
      problem ??= { code: 'read_failed', name: file.name }
    }
  }
  // The shared check is the authority (the IPC guard runs the same one).
  const violation = checkAttachments(out.map((a) => a.part))
  if (violation) return { attachments: [...existing], problem: violation }
  return { attachments: out, problem }
}

/** A long paste as a text attachment (named by the caller, e.g. 粘贴的文本 2.txt). */
export function pastedTextAttachment(text: string, name: string): DraftAttachment {
  // Lines as an editor counts them: a trailing newline does not start another line.
  let lines = 1
  for (let i = 0; i < text.length - 1; i++) if (text.charCodeAt(i) === 10) lines++
  return {
    id: newAttachmentId(),
    part: { type: 'file', mediaType: 'text/plain', data: utf8ToBase64(text), name },
    pasted: { chars: text.length, lines },
  }
}

/** Attachments of a recorded prompt, back as draft attachments (编辑 / 重新发送). */
export function draftAttachmentsOf(content: readonly ContentPart[]): DraftAttachment[] {
  return content.flatMap((p) => (p.type === 'text' ? [] : [{ id: newAttachmentId(), part: p }]))
}

/** The sentence for a problem, shown under the chips (CLAUDE.md §4.6: validation stays inline). */
export function attachmentProblemText(problem: AttachmentProblem): string {
  switch (problem.code) {
    case 'too_many':
      return t('agent.attachments.error.tooMany', { max: problem.max })
    case 'image_too_large':
      return t('agent.attachments.error.imageTooLarge', { name: problem.name, max: formatBytes(problem.max) })
    case 'file_too_large':
      return t('agent.attachments.error.fileTooLarge', { name: problem.name, max: formatBytes(problem.max) })
    case 'total_too_large':
      return t('agent.attachments.error.totalTooLarge', { max: formatBytes(problem.max) })
    case 'unsupported_type':
      return t('agent.attachments.error.unsupportedType', { name: problem.name })
    case 'read_failed':
      return t('agent.attachments.error.readFailed', { name: problem.name })
  }
}
