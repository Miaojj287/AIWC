import { describe, expect, it } from 'vitest'
import { contentStats, extensionOf, fileName, isDirty, isMarkdownFile, parentDir, previewKind } from './fileModel'

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
