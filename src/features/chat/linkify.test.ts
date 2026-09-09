import { describe, expect, it } from 'vitest'
import { segmentText, splitLinks } from './linkify'

describe('splitLinks', () => {
  it('finds http and www links and keeps trailing punctuation outside', () => {
    expect(splitLinks('看这个 https://example.com/a?b=1。 还有 www.test.cn，好')).toEqual([
      { text: '看这个 ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: '。 还有 ' },
      { text: 'www.test.cn', href: 'https://www.test.cn' },
      { text: '，好' },
    ])
  })
  it('returns the text as one segment when there is no link', () => {
    expect(splitLinks('纯文本')).toEqual([{ text: '纯文本' }])
    expect(splitLinks('')).toEqual([{ text: '' }])
  })
})

describe('segmentText', () => {
  it('marks case-insensitive matches without breaking links', () => {
    expect(segmentText('周报 Weekly 周报', '周报')).toEqual([{ text: '周报', mark: true }, { text: ' Weekly ' }, { text: '周报', mark: true }])
    const segs = segmentText('见 https://a.com/Report', 'report')
    expect(segs).toEqual([{ text: '见 ' }, { text: 'https://a.com/', href: 'https://a.com/Report' }, { text: 'Report', href: 'https://a.com/Report', mark: true }])
  })
  it('ignores an empty query', () => {
    expect(segmentText('abc', '  ')).toEqual([{ text: 'abc' }])
  })
})
