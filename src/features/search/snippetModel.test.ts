import { describe, expect, it } from 'vitest'
import type { SearchHit, WxMessage } from '@aiwc/protocol'
import { copyTextOf, matchTerms, parseSnippet } from './snippetModel'

const marks = (parts: ReturnType<typeof parseSnippet>) => parts.filter((p) => p.mark).map((p) => p.text)
const plain = (parts: ReturnType<typeof parseSnippet>) => parts.map((p) => p.text).join('')

function hit(text: string, snippet: string): SearchHit {
  const message: WxMessage = {
    id: 'm1',
    sessionId: 's1',
    seq: 1,
    createdAt: 1,
    senderId: 'wxid_sender',
    isSelf: false,
    kind: 'text',
    text,
    anchor: { sessionId: 's1', messageId: 'm1', seq: 1, createdAt: 1 },
  }
  return { message, score: 1, snippet, source: 'fts' }
}

describe('parseSnippet', () => {
  it('turns the substrate FTS markers into marks and keeps the ellipses as text', () => {
    const parts = parseSnippet('…周五[聚餐]改到周六…', '聚餐')
    expect(parts).toEqual([
      { text: '…周五', mark: false },
      { text: '聚餐', mark: true },
      { text: '改到周六…', mark: false },
    ])
  })

  it('leaves WeChat emoji brackets alone when they do not wrap a query term', () => {
    const parts = parseSnippet('[微笑] 明天[开会]吧', '开会')
    expect(marks(parts)).toEqual(['开会'])
    expect(plain(parts)).toBe('[微笑] 明天开会吧')
  })

  it('unwraps the inner marker of a bracketed emoji that is itself the match', () => {
    // The LIKE lane wraps the first occurrence: the emoji 「[微笑]」 becomes 「[[微笑]]」.
    const parts = parseSnippet('他回了[[微笑]]', '微笑')
    expect(parts).toEqual([
      { text: '他回了[', mark: false },
      { text: '微笑', mark: true },
      { text: ']', mark: false },
    ])
  })

  it('marks occurrences the substrate left unmarked (the LIKE lane marks only the first)', () => {
    const parts = parseSnippet('[收到] 我也收到了', '收到')
    expect(marks(parts)).toEqual(['收到', '收到'])
    expect(plain(parts)).toBe('收到 我也收到了')
  })

  it('marks terms in an excerpt that carries no markers at all', () => {
    expect(marks(parseSnippet('The Quarterly report is due', 'quarterly report'))).toEqual(['Quarterly', 'report'])
  })

  it('accepts a prefix-matched Latin token and a match split across Han / Latin runs', () => {
    expect(marks(parseSnippet('say [Hello] there', 'hel'))).toEqual(['Hello'])
    expect(marks(parseSnippet('[微信]和[abc]', '微信abc'))).toEqual(['微信', 'abc'])
  })

  it('does not light up every lone Latin letter', () => {
    expect(marks(parseSnippet('a cat and a hat', 'a'))).toEqual([])
  })

  it('keeps unbalanced and empty brackets as text', () => {
    expect(parseSnippet('a [b] c]', 'zz')).toEqual([{ text: 'a [b] c]', mark: false }])
    expect(plain(parseSnippet('x [] [yes', 'yes'))).toBe('x [] [yes')
    expect(marks(parseSnippet('x [] [yes', 'yes'))).toEqual(['yes'])
  })

  it('collapses whitespace and returns text, never markup', () => {
    const parts = parseSnippet('<b>不是</b>\n\n[标签]', '标签')
    expect(plain(parts)).toBe('<b>不是</b> 标签')
    expect(marks(parts)).toEqual(['标签'])
  })
})

describe('matchTerms', () => {
  it('splits like the substrate: whitespace, Han / non-Han runs, edge punctuation, lower case', () => {
    expect(matchTerms('  Hello,  微信ABC  “周会” ')).toEqual(['hello', '微信', 'abc', '周会'])
  })
})

describe('copyTextOf', () => {
  it('copies the message text, else the snippet without markers', () => {
    expect(copyTextOf(hit(' 全文 ', 'x'), 'x')).toBe('全文')
    expect(copyTextOf(hit('', '…[文件]名…'), '文件')).toBe('…文件名…')
  })
})
