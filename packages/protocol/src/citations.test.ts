import { describe, expect, it } from 'vitest'
import { findCitationClaims, formatCitation, unmatchedQuotes } from './citations'

const link = (m: string) => formatCitation({ sessionId: 'wxid_xw', messageId: m }, '02-14 19:28')

describe('findCitationClaims', () => {
  it('scopes each citation to the text since the previous one in the same block', () => {
    const md = [
      `4. 在两个男人之间纠结：你一句话说破她的处境 ${link('wx:1:1')}`,
      '',
      `> “你和小吴已经在一起了” ${link('wx:26442:9')}`,
      '',
      `她先说“一点都不享受” ${link('wx:2:2')}，又说“算了” ${link('wx:3:3')}`,
    ].join('\n')
    const claims = findCitationClaims(md)
    expect(claims.map((c) => c.messageId)).toEqual(['wx:1:1', 'wx:26442:9', 'wx:2:2', 'wx:3:3'])
    expect(claims[1]!.context).toContain('你和小吴已经在一起了')
    expect(claims[2]!.context).toContain('一点都不享受')
    expect(claims[3]!.context).not.toContain('一点都不享受')
    expect(claims[3]!.context).toContain('算了')
  })

  it('joins a multi-line paragraph and a multi-line quote, but not separate list items', () => {
    const md = `她说“明天见”\n然后就走了 ${link('wx:1:1')}\n- 第二条 ${link('wx:2:2')}\n> “第一行\n> 第二行” ${link('wx:3:3')}`
    const claims = findCitationClaims(md)
    expect(claims[0]!.context).toContain('明天见')
    expect(claims[1]!.context).not.toContain('明天见')
    expect(claims[2]!.context).toContain('第一行')
  })

  it('ignores ordinary links and anything inside fenced code', () => {
    const md = `见 [文档](https://x.y)\n\`\`\`\n“假的” ${link('wx:9:9')}\n\`\`\``
    expect(findCitationClaims(md)).toEqual([])
  })
})

describe('unmatchedQuotes', () => {
  it('lists only the quoted segments missing from the message', () => {
    const message = { text: '你自己都说没有 yanda 你会和小吴纠缠一阵子' }
    expect(unmatchedQuotes('“你会和小吴纠缠一阵子”', message)).toEqual([])
    expect(unmatchedQuotes('“你和小吴已经在一起了”与“纠缠一阵子”', message)).toEqual(['你和小吴已经在一起了'])
  })
})
