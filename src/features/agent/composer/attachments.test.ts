// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MAX_ATTACHMENTS, MAX_IMAGE_BYTES, base64ByteLength } from '@aiwc/protocol'
import { addFiles, attachmentProblemText, draftAttachmentsOf, mediaTypeOf, pastedTextAttachment } from './attachments'

const file = (name: string, type: string, size = 4) => new File([new Uint8Array(size)], name, { type })

describe('composer attachments', () => {
  it('reads images and files into parts', async () => {
    const { attachments, problem } = await addFiles([], [file('a.png', 'image/png'), file('r.pdf', 'application/pdf')])
    expect(problem).toBeUndefined()
    expect(attachments.map((a) => [a.part.type, a.part.mediaType, a.part.name])).toEqual([
      ['image', 'image/png', 'a.png'],
      ['file', 'application/pdf', 'r.pdf'],
    ])
    expect(base64ByteLength(attachments[0]?.part.data ?? '')).toBe(4)
  })

  it('refuses what breaks a limit before reading it, keeps the rest', async () => {
    const big = file('huge.png', 'image/png')
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 })
    const result = await addFiles([], [file('ok.png', 'image/png'), big])
    expect(result.attachments).toHaveLength(1)
    expect(result.problem).toMatchObject({ code: 'image_too_large', name: 'huge.png' })
    expect(attachmentProblemText(result.problem!)).toContain('huge.png')

    const many = await addFiles(
      [],
      Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => file(`${i}.txt`, 'text/plain')),
    )
    expect(many.attachments).toHaveLength(MAX_ATTACHMENTS)
    expect(many.problem).toEqual({ code: 'too_many', max: MAX_ATTACHMENTS })

    const heic = await addFiles([], [file('x.heic', 'image/heic')])
    expect(heic.problem).toEqual({ code: 'unsupported_type', name: 'x.heic' })
  })

  it('guesses a type from the extension when the OS gives none', () => {
    expect(mediaTypeOf({ name: 'notes.MD', type: '' })).toBe('text/markdown')
    expect(mediaTypeOf({ name: 'blob', type: '' })).toBe('application/octet-stream')
    expect(mediaTypeOf({ name: 'a', type: 'text/plain; charset=utf-8' })).toBe('text/plain')
  })

  it('turns a long paste into a UTF-8 text attachment and back', () => {
    const a = pastedTextAttachment('你好\nworld', 'paste.txt')
    expect(a.pasted).toEqual({ chars: 8, lines: 2 })
    expect(a.part).toMatchObject({ type: 'file', mediaType: 'text/plain', name: 'paste.txt' })
    const bytes = Uint8Array.from(atob(a.part.data), (c) => c.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe('你好\nworld')
    const back = draftAttachmentsOf([{ type: 'text', text: 'x' }, a.part])
    expect(back.map((b) => b.part)).toEqual([a.part])
  })
})
