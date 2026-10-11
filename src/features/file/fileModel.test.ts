import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  contentStats,
  extensionOf,
  fileName,
  isDirty,
  isMarkdownFile,
  isolatedHtml,
  parentDir,
  previewKind,
  previewSource,
  toDataUrl,
} from './fileModel'
import { delimiterFor, MAX_CSV_ROWS, parseDelimited } from './csv'

describe('paths', () => {
  it('extracts name, dir and extension for posix and windows paths', () => {
    expect(fileName('/Users/a/周报草稿.md')).toBe('周报草稿.md')
    expect(fileName('C:\\Users\\a\\report.MD')).toBe('report.MD')
    expect(parentDir('/Users/a/周报草稿.md')).toBe('/Users/a')
    expect(extensionOf('C:\\Users\\a\\report.MD')).toBe('md')
    expect(extensionOf('/tmp/.env')).toBe('')
    expect(extensionOf('noext')).toBe('')
  })
})

describe('previewKind', () => {
  it('routes markdown / text / image / unsupported', () => {
    expect(isMarkdownFile('/a/b.md')).toBe(true)
    expect(isMarkdownFile('/a/b.txt', 'text/markdown')).toBe(true)
    expect(previewKind('/a/b.markdown')).toBe('markdown')
    expect(previewKind('/a/data.json')).toBe('text')
    expect(previewKind('/a/x.bin', 'text/plain')).toBe('text')
    expect(previewKind('/a/pic.PNG')).toBe('image')
    expect(previewKind('/a/x.bin')).toBe('unsupported')
  })

  it('routes the richer previews and says how each is loaded', () => {
    expect(previewKind('/a/t.csv')).toBe('csv')
    expect(previewKind('/a/t.TSV')).toBe('csv')
    expect(previewKind('/a/p.htm')).toBe('html')
    expect(previewKind('/a/r.pdf')).toBe('pdf')
    expect(previewKind('/a/v.mov')).toBe('video')
    expect(previewKind('/a/s.m4a')).toBe('audio')
    expect(previewKind('/a/w.docx')).toBe('docx')
    expect(previewKind('/a/x.xlsx')).toBe('xlsx')
    // An unknown extension sniffed as text by file:read.
    expect(previewKind('/a/x.conf2', 'text/plain; charset=utf-8')).toBe('text')
    expect(previewSource('pdf')).toBe('read')
    expect(previewSource('docx')).toBe('document')
    expect(previewSource('video')).toBe('stream')
    expect(previewSource('unsupported', '/a/archive.ZIP')).toBe('none')
    expect(previewSource('unsupported', '/a/notes.conf2')).toBe('read')
  })
})

describe('toDataUrl (images arrive from file:read as bare base64)', () => {
  it('prefixes base64 with the media type so <img> can show it', () => {
    expect(toDataUrl('iVBORw0KGgo=', 'image/png')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(toDataUrl('abc=', 'image/jpeg; charset=binary')).toBe('data:image/jpeg;base64,abc=')
  })
  it('passes data URLs through and encodes raw SVG text', () => {
    expect(toDataUrl('data:image/gif;base64,R0lG', 'image/gif')).toBe('data:image/gif;base64,R0lG')
    expect(toDataUrl('<svg xmlns="x"/>', 'image/svg+xml')).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="x"/>')}`,
    )
  })
  it('decodes base64 to bytes for the PDF viewer', () => {
    expect([...base64ToBytes('JVBERg==')]).toEqual([0x25, 0x50, 0x44, 0x46])
  })
})

describe('isolatedHtml', () => {
  it('puts a no-script, no-network CSP in front of the document', () => {
    const doc = isolatedHtml('<html><body><img src="https://x/y.png"></body></html>')
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<html>'))
    expect(doc).toContain("default-src 'none'")
    expect(doc).not.toContain('script-src')
  })
})

describe('parseDelimited', () => {
  it('handles quotes, embedded delimiters / newlines, CRLF and a BOM', () => {
    const csv = '\uFEFFname,note\r\n"Lee, A","said ""hi""\nthen left"\r\nB,\r\n'
    expect(parseDelimited(csv)).toEqual({
      rows: [
        ['name', 'note'],
        ['Lee, A', 'said "hi"\nthen left'],
        ['B', ''],
      ],
      truncated: false,
    })
  })
  it('reads TSV and caps the rows', () => {
    expect(delimiterFor('/a/b.tsv')).toBe('\t')
    expect(parseDelimited('a\tb\n1\t2', '\t').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    const big = Array.from({ length: MAX_CSV_ROWS + 5 }, (_, i) => String(i)).join('\n')
    const out = parseDelimited(big)
    expect(out.rows).toHaveLength(MAX_CSV_ROWS)
    expect(out.truncated).toBe(true)
  })
})

describe('isDirty / contentStats', () => {
  it('ignores CRLF differences and unknown loaded state', () => {
    expect(isDirty(undefined, 'x')).toBe(false)
    expect(isDirty('a\r\nb', 'a\nb')).toBe(false)
    expect(isDirty('a', 'b')).toBe(true)
  })
  it('counts non-space chars and lines', () => {
    expect(contentStats('')).toEqual({ chars: 0, lines: 0 })
    expect(contentStats('你好 世界\nabc')).toEqual({ chars: 7, lines: 2 })
  })
})
