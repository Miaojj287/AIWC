import { describe, expect, it } from 'vitest'
import { asTurnId, MAX_TEXT_ATTACHMENT_CHARS, newItemId, type HistoryItem } from '@aiwc/protocol'
import { attachmentToModelPart, estimateAttachmentTokens } from './attachmentParts'
import { historyToModelMessages } from './messages'

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

describe('attachments sent to the model', () => {
  it('sends images to a model that sees and a note to one that does not', () => {
    const image = { type: 'image' as const, mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }
    expect(attachmentToModelPart(image)).toEqual({ type: 'image', image: 'AAAA', mediaType: 'image/png' })
    const note = attachmentToModelPart(image, { vision: false })
    expect(note.type).toBe('text')
    expect(JSON.stringify(note)).toContain('shot.png')
    expect(JSON.stringify(note)).not.toContain('AAAA')
  })

  it('inlines text files, bounded, and names them', () => {
    const part = attachmentToModelPart({
      type: 'file',
      mediaType: 'text/plain',
      data: b64('你好\nworld'),
      name: 'a.txt',
    })
    expect(part).toEqual({
      type: 'text',
      text: '<attached_file name="a.txt" type="text/plain">\n你好\nworld\n</attached_file>',
    })
    const long = 'x'.repeat(MAX_TEXT_ATTACHMENT_CHARS + 50)
    const cut = attachmentToModelPart({ type: 'file', mediaType: 'text/markdown', data: b64(long), name: 'b.md' })
    expect(cut.type === 'text' && cut.text.length).toBeLessThan(MAX_TEXT_ATTACHMENT_CHARS + 200)
    expect(JSON.stringify(cut)).toContain('truncated 50 chars')
  })

  it('keeps PDFs as files and describes other binaries', () => {
    expect(attachmentToModelPart({ type: 'file', mediaType: 'application/pdf', data: 'JVBE', name: 'r.pdf' })).toEqual({
      type: 'file',
      data: 'JVBE',
      mediaType: 'application/pdf',
      filename: 'r.pdf',
    })
    const zip = attachmentToModelPart({ type: 'file', mediaType: 'application/zip', data: 'UEsDBA==', name: 'a.zip' })
    expect(zip.type).toBe('text')
    expect(JSON.stringify(zip)).toContain('a.zip')
  })

  it('estimates tokens from the size, not a flat guess', () => {
    const small = estimateAttachmentTokens({ type: 'file', mediaType: 'text/plain', data: b64('hi'), name: 'a.txt' })
    const big = estimateAttachmentTokens({
      type: 'file',
      mediaType: 'text/plain',
      data: b64('y'.repeat(30_000)),
      name: 'b.txt',
    })
    expect(big).toBeGreaterThan(small + 9_000)
  })

  it('history conversion honours the vision flag', () => {
    const items: HistoryItem[] = [
      {
        type: 'user_message',
        id: newItemId(),
        turnId: asTurnId('t'),
        createdAt: 1,
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', mediaType: 'image/png', data: 'AAAA' },
        ],
        mentions: [],
      },
    ]
    expect(JSON.stringify(historyToModelMessages(items))).toContain('"type":"image"')
    expect(JSON.stringify(historyToModelMessages(items, { vision: false }))).not.toContain('"type":"image"')
  })
})
