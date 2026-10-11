import { describe, expect, it } from 'vitest'
import {
  base64ByteLength,
  checkAttachments,
  isLongPaste,
  isTextAttachment,
  LONG_PASTE_CHARS,
  LONG_PASTE_LINES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  type AttachmentPart,
} from './attachments'
import { modelSupportsVision } from './modelVision'

/** base64 of roughly `bytes` bytes (content irrelevant: only the length is measured). */
const ofBytes = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4)

describe('attachment limits', () => {
  it('measures decoded size', () => {
    expect(base64ByteLength('')).toBe(0)
    expect(base64ByteLength('aGk=')).toBe(2)
    expect(base64ByteLength('aGVsbG8=')).toBe(5)
    expect(base64ByteLength('AAAA')).toBe(3)
  })

  it('accepts a normal set and names the first broken rule', () => {
    const png: AttachmentPart = { type: 'image', mediaType: 'image/png', data: ofBytes(1000), name: 'a.png' }
    expect(checkAttachments([png])).toBeUndefined()
    expect(checkAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => png))).toEqual({
      code: 'too_many',
      max: MAX_ATTACHMENTS,
    })
    expect(checkAttachments([{ ...png, data: ofBytes(MAX_IMAGE_BYTES + 3) }])).toMatchObject({
      code: 'image_too_large',
      name: 'a.png',
    })
    expect(checkAttachments([{ ...png, mediaType: 'image/tiff' }])).toMatchObject({ code: 'unsupported_type' })
    const file: AttachmentPart = {
      type: 'file',
      mediaType: 'application/pdf',
      data: ofBytes(8 * 1024 * 1024),
      name: 'f',
    }
    expect(checkAttachments([file, file, file])).toMatchObject({ code: 'total_too_large' })
  })

  it('treats long or many-line pastes as attachments', () => {
    expect(isLongPaste('short')).toBe(false)
    expect(isLongPaste('x'.repeat(LONG_PASTE_CHARS))).toBe(true)
    expect(isLongPaste('a\n'.repeat(LONG_PASTE_LINES))).toBe(true)
    expect(isLongPaste('a\n'.repeat(LONG_PASTE_LINES - 2))).toBe(false)
  })

  it('recognises text files by type or extension', () => {
    expect(isTextAttachment('text/csv')).toBe(true)
    expect(isTextAttachment('application/json')).toBe(true)
    expect(isTextAttachment('', 'notes.md')).toBe(true)
    expect(isTextAttachment('application/octet-stream', 'a.ts')).toBe(true)
    expect(isTextAttachment('application/zip', 'a.zip')).toBe(false)
  })
})

describe('modelSupportsVision', () => {
  it("follows the model's own setting, which the user can switch either way", () => {
    // explicit off wins even for an image-capable model
    expect(modelSupportsVision({ kind: 'openai' }, { modelId: 'gpt-4o', supportsVision: false })).toBe(false)
    expect(modelSupportsVision({ kind: 'anthropic' }, { modelId: 'claude-sonnet-4-5', supportsVision: false })).toBe(
      false,
    )
    // explicit on is honoured even when nothing is known about the model
    expect(modelSupportsVision({ kind: 'openai-compatible' }, { modelId: 'my-model', supportsVision: true })).toBe(true)
  })
})
