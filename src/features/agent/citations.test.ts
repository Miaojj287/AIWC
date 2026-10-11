import { describe, expect, it } from 'vitest'
import { formatCitation } from '@aiwc/protocol'
import { citationTime, parseCitation, planCitations, verifyClaim } from './citations'

describe('citation links', () => {
  it('round-trips the wx:// href the tools emit', () => {
    const href = formatCitation({ sessionId: 'wxid_abc', messageId: 'wx:26442:1739500000000' }, '02-14 19:28')
    expect(href).toBe('[02-14 19:28](wx://wxid_abc/wx:26442:1739500000000)')
    expect(parseCitation('wx://wxid_abc/wx:26442:1739500000000')).toEqual({
      sessionId: 'wxid_abc',
      messageId: 'wx:26442:1739500000000',
    })
    expect(parseCitation('wx://12345@chatroom/wx:1:2')).toEqual({ sessionId: '12345@chatroom', messageId: 'wx:1:2' })
  })

  it('rejects ordinary links and malformed anchors', () => {
    expect(parseCitation('https://example.com/x')).toBeUndefined()
    expect(parseCitation('wx://onlysession')).toBeUndefined()
    expect(parseCitation('wx:///wx:1:2')).toBeUndefined()
    expect(parseCitation('wx://s/')).toBeUndefined()
  })
})

describe('quote verification', () => {
  const message = { text: '你和小吴已经在一起了吗？我看你们朋友圈挺甜的', media: undefined, quote: undefined }

  it('passes a verbatim quote, flags a paraphrase, and has nothing to say without quotes', () => {
    expect(verifyClaim(['你和小吴已经在一起了'], message).verdict).toBe('verbatim')
    expect(verifyClaim(['已经和小吴在一起'], message).verdict).toBe('mismatch')
    expect(verifyClaim([], message).verdict).toBe('unquoted')
  })

  it('also accepts text that lives in a voice transcript or the quoted reply', () => {
    const voice = {
      text: '[语音消息]',
      media: { kind: 'voice' as const, transcript: '明天下午三点老地方' },
      quote: undefined,
    }
    expect(verifyClaim(['明天下午三点'], voice).verdict).toBe('verbatim')
    const reply = { text: '好', media: undefined, quote: { text: '报价单能再发一份吗' } }
    expect(verifyClaim(['报价单能再发一份吗'], reply).verdict).toBe('verbatim')
  })

  it('pairs quotes with the citations that follow them, the way the chip and the host audit both do', () => {
    const cite = (id: string) => ({
      kind: 'cite' as const,
      label: '07-17 13:32',
      link: '',
      sessionId: 's',
      messageId: id,
    })
    const claims = planCitations([
      { kind: 'text', text: '你回：「🤔」「高定奶茶」 ' },
      cite('a'),
      { kind: 'text', text: ' ' },
      cite('b'),
    ])
    expect(claims.map((c) => c.quotes)).toEqual([['高定奶茶'], []])
  })

  it('formats the chip time as MM-DD HH:mm', () => {
    expect(citationTime(new Date(2026, 1, 14, 19, 28).getTime())).toBe('02-14 19:28')
  })
})
