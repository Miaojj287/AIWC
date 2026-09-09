import { describe, it, expect } from 'vitest'
import { parseRichContent } from './richContent'
import { rowToWxMessage } from './messageMapper'
const ctx = { sessionId: 's', isGroup: true, selfWxid: 'me' }
const app = (type: number, content: string) => `<msg><appmsg><type>${type}</type>${content}</appmsg></msg>`
describe('reference message presentation', () => {
  it('routes pats to a notice and preserves its readable title', () => {
    const m = rowToWxMessage({ local_id: 1, local_type: 49, message_content: app(62, '<title><![CDATA[我拍了拍 "庄曼琦" 说你好👋🏻]]></title><patinfo/>') }, ctx)
    expect(m.kind).toBe('system')
    expect(m.text).toBe('我拍了拍 "庄曼琦" 说你好👋🏻')
    expect(m.rich).toBeUndefined()
  })
  it('retains official article title, signed URL, cover, and source', () => {
    const rich = parseRichContent(app(5, '<title><![CDATA[文章 & 标题]]></title><url>https://mp.weixin.qq.com/s?a=1&amp;b=x%2Fy</url><coverpicimageurl>https://img.example/a.jpg</coverpicimageurl><sourcedisplayname>腾讯游戏</sourcedisplayname>'), 49)
    expect(rich).toMatchObject({ type: 'article', title: '文章 & 标题', url: 'https://mp.weixin.qq.com/s?a=1&b=x%2Fy', coverUrl: 'https://img.example/a.jpg', source: '腾讯游戏' })
  })
  it('preserves separate links in multi-article pushes', () => {
    const xml = '<msg><mmreader><category><item><title>A</title><url>https://example.com/a</url></item><item><title>B</title><url>https://example.com/b</url></item></category></mmreader></msg>'
    const m = rowToWxMessage({ local_id: 2, local_type: 285212721, message_content: xml }, ctx)
    expect(m.kind).toBe('link')
    expect(m.rich?.entries).toHaveLength(2)
    expect(m.rich?.entries?.[1]?.url).toBe('https://example.com/b')
  })
  it('uses cards for announcements, mini programs, music and payment records', () => {
    for (const [type, expected] of [[87, 'announcement'], [33, 'miniProgram'], [36, 'miniProgram'], [3, 'music'], [2000, 'transfer'], [2001, 'redPacket'], [51, 'channel'], [115, 'gift']] as const) {
      expect(parseRichContent(app(type, '<title>测试</title>'), 49)?.type).toBe(expected)
    }
  })
  it('opens valid locations and rejects invalid coordinates and unsafe links', () => {
    expect(parseRichContent('<msg><location x="22.5" y="114" poiname="深圳" label="地址" /></msg>', 48)?.url).toContain('position=114,22.5')
    expect(parseRichContent('<msg><location poiname="未知" /></msg>', 48)?.url).toBeUndefined()
    expect(parseRichContent(app(5, '<url>javascript:alert(1)</url>'), 49)?.url).toBeUndefined()
  })
  it('extracts the embedded forwarded-record entries', () => {
    expect(parseRichContent(app(19, '<title>聊天记录</title><recorditem><![CDATA[<recordinfo><datalist><dataitem><sourcename>A</sourcename><datadesc>你好</datadesc></dataitem></datalist></recordinfo>]]></recorditem>'), 49)?.entries).toEqual([{ title: 'A', description: '你好' }])
  })
})
