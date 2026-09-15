import { describe, expect, it } from 'vitest'
import { formatCitation } from '@aiwc/protocol'
import { citationTime, extractQuotes, normalizeForMatch, parseCitation, verifyQuotes } from './citations'

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

  it('extracts every quoted segment, Chinese or ASCII quotes alike', () => {
    expect(extractQuotes('她说“一点都不享受”，又说「算了吧」和 "fine"')).toEqual(['一点都不享受', '算了吧', 'fine'])
    expect(extractQuotes('没有引号')).toEqual([])
    expect(extractQuotes('“x”')).toEqual([]) // too short to mean anything
  })

  it('ignores punctuation, width and case when matching', () => {
    expect(normalizeForMatch('你 和 小吴，已经在一起了！')).toBe('你和小吴已经在一起了')
    expect(normalizeForMatch('Ｆｉｎｅ, OK')).toBe('fineok')
  })

  it('passes a verbatim quote, flags a paraphrase, and has nothing to say without quotes', () => {
    expect(verifyQuotes('隔天情人节你直接定罪：“你和小吴已经在一起了”', message)).toBe('verbatim')
    expect(verifyQuotes('她承认“已经和小吴在一起”', message)).toBe('mismatch')
    expect(verifyQuotes('隔天你就问了她这件事', message)).toBe('unquoted')
  })

  it('also accepts text that lives in a voice transcript or the quoted reply', () => {
    const voice = {
      text: '[语音消息]',
      media: { kind: 'voice' as const, transcript: '明天下午三点老地方' },
      quote: undefined,
    }
    expect(verifyQuotes('约的是“明天下午三点”', voice)).toBe('verbatim')
    const reply = { text: '好', media: undefined, quote: { text: '报价单能再发一份吗' } }
    expect(verifyQuotes('对方问“报价单能再发一份吗”', reply)).toBe('verbatim')
  })

  it('formats the chip time as MM-DD HH:mm', () => {
    expect(citationTime(new Date(2026, 1, 14, 19, 28).getTime())).toBe('02-14 19:28')
  })
})
