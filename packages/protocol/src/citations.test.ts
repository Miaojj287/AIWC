import { describe, expect, it } from 'vitest'
import {
  findCitationClaims,
  formatCitation,
  normalizeForMatch,
  quoteMatches,
  quoteSpans,
  verifyClaim,
} from './citations'

const link = (m: string) => formatCitation({ sessionId: 'wxid_xw', messageId: m }, '02-14 19:28')
const msg = (text: string) => ({ text })

describe('findCitationClaims', () => {
  it('gives each citation the quote written right before it', () => {
    const md = [
      `4. 在两个男人之间纠结：你一句话说破她的处境 ${link('wx:1:1')}`,
      '',
      `> “你和小吴已经在一起了” ${link('wx:26442:9')}`,
      '',
      `她先说“一点都不享受” ${link('wx:2:2')}，又说“算了” ${link('wx:3:3')}`,
    ].join('\n')
    const claims = findCitationClaims(md)
    expect(claims.map((c) => c.messageId)).toEqual(['wx:1:1', 'wx:26442:9', 'wx:2:2', 'wx:3:3'])
    expect(claims.map((c) => c.quotes)).toEqual([[], ['你和小吴已经在一起了'], ['一点都不享受'], ['算了']])
  })

  it('pairs a run of quotes with a run of citations in order', () => {
    const md = `你接话：「还以为老陈这么抠搜了」「喝太多导致睡不着」 ${link('a')} ${link('b')}`
    const [a, b] = findCitationClaims(md)
    expect(a?.quotes).toEqual(['还以为老陈这么抠搜了'])
    expect(b?.quotes).toEqual(['喝太多导致睡不着'])
    expect(a?.run.map((r) => r.messageId)).toEqual(['a', 'b'])
  })

  it('hands extra quotes to the last citation of the run', () => {
    const [only] = findCitationClaims(`小蜜否认：「不是的」「只是小陈另有其人」 ${link('x')}`)
    expect(only?.quotes).toEqual(['不是的', '只是小陈另有其人'])
  })

  it('does not attach a quote that sits far before the citation (a quoted nickname, an earlier remark)', () => {
    const md = `“陈姐 / 老陈”到底是不是小蜜，群里说法打架：小蜜本人明确说过「只是小陈另有其人」；但庄曼琦后来又在群里 @lgyyyy（就是小蜜）说「陈姐，你的鼠标真好用」 ${link('y')}`
    const [claim] = findCitationClaims(md)
    expect(claim?.quotes).toEqual(['陈姐，你的鼠标真好用'])
  })

  it('joins a multi-line paragraph and a multi-line quote, but not separate list items', () => {
    const md = `她说“明天见”\n然后就走了 ${link('wx:1:1')}\n- 第二条 ${link('wx:2:2')}\n> “第一行\n> 第二行” ${link('wx:3:3')}`
    const claims = findCitationClaims(md)
    expect(claims[0]?.quotes).toEqual(['明天见'])
    expect(claims[1]?.quotes).toEqual([])
    expect(claims[2]?.quotes[0]).toContain('第一行')
  })

  it('ignores ordinary links and anything inside fenced code', () => {
    const md = `见 [文档](https://x.y)\n\`\`\`\n“假的” ${link('wx:9:9')}\n\`\`\``
    expect(findCitationClaims(md)).toEqual([])
  })
})

describe('quote matching', () => {
  it('reads quotes in order, outer quote only', () => {
    expect(quoteSpans('她说“一点都不享受”，又说「算了吧，“好的”」和 "fine"').map((q) => q.text)).toEqual([
      '一点都不享受',
      '算了吧，“好的”',
      'fine',
    ])
    expect(quoteSpans('“x”')).toEqual([])
  })

  it('ignores punctuation, width, case and invisible characters', () => {
    expect(normalizeForMatch('你 和 小吴，已经在一起了！')).toBe('你和小吴已经在一起了')
    expect(normalizeForMatch('Ｆｉｎｅ, OK')).toBe('fineok')
    expect(normalizeForMatch('好的​❤️谢 谢')).toBe('好的谢谢')
  })

  it('accepts an @mention gap, a dropped emoji code, a sender prefix and an elision', () => {
    expect(quoteMatches('陈姐，你的鼠标真好用', msg('@lgyyyy 陈姐，你的鼠标真好用'))).toBe(true)
    expect(quoteMatches('笑死我了', msg('笑死我了[捂脸]'))).toBe(true)
    expect(quoteMatches('笑死[捂脸]我了', msg('笑死我了'))).toBe(true)
    expect(quoteMatches('庄曼琦：今天会有下午茶吗？', msg('今天会有下午茶吗？想喝奶茶了'))).toBe(true)
    expect(quoteMatches('今天会有……想喝奶茶了', msg('今天会有下午茶吗？想喝奶茶了'))).toBe(true)
    expect(quoteMatches('想喝奶茶了……今天会有', msg('今天会有下午茶吗？想喝奶茶了'))).toBe(false)
    expect(quoteMatches('你和小吴已经在一起了', msg('她的反应是不能和 yanda 说'))).toBe(false)
  })

  it('looks in the transcript, file name, link title and quoted reply too', () => {
    expect(quoteMatches('明天七点见', { text: '[语音]', media: { kind: 'voice', transcript: '明天七点见' } })).toBe(
      true,
    )
    expect(quoteMatches('季度报告', { text: '', media: { kind: 'file', fileName: '季度报告.pdf' } })).toBe(true)
  })

  it('passes a quote found in a sibling citation of the run, and flags only what is nowhere', () => {
    const a = msg('还以为老陈这么抠搜了')
    const b = msg('喝太多导致睡不着')
    expect(verifyClaim(['喝太多导致睡不着'], a, [b])).toEqual({ verdict: 'verbatim', unmatched: [] })
    expect(verifyClaim(['陈姐 / 老陈'], a, [b])).toEqual({ verdict: 'mismatch', unmatched: ['陈姐 / 老陈'] })
    expect(verifyClaim([], a).verdict).toBe('unquoted')
  })
})
