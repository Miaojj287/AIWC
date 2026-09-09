import { describe, expect, it } from 'vitest'
import { toMediaUrl } from './mediaUrl'

describe('toMediaUrl', () => {
  it('passes data / http / aiwc-media urls through', () => {
    expect(toMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(toMediaUrl('https://x.y/z.png')).toBe('https://x.y/z.png')
    expect(toMediaUrl('aiwc-media:///a.png')).toBe('aiwc-media:///a.png')
  })
  it('wraps local paths and encodes spaces', () => {
    expect(toMediaUrl('/Users/a b/图.png')).toBe('aiwc-media:///Users/a%20b/%E5%9B%BE.png')
    expect(toMediaUrl('C:\\wx\\img.dat')).toBe('aiwc-media:///C:/wx/img.dat')
    expect(toMediaUrl(undefined)).toBeUndefined()
  })
})

it('escapes path delimiters without creating a URL fragment or query', () => {
  const url = new URL(toMediaUrl('/cache/a#b?c%.png')!)
  expect(url.hash).toBe('')
  expect(url.search).toBe('')
  expect(decodeURIComponent(url.pathname)).toBe('/cache/a#b?c%.png')
})
