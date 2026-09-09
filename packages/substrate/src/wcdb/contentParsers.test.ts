import { describe, expect, it } from 'vitest'
import {
  parseEmojiInfo,
  parseFileInfo,
  parseImageInfo,
  parseLinkInfo,
  parseMessageContent,
  parseQuoteMessage,
  parseVideoDuration,
  parseVideoMd5,
  parseVoiceDurationMs,
  processSummary,
} from './contentParsers'

describe('parseMessageContent', () => {
  it('handles plain text with sender prefix', () => {
    expect(parseMessageContent('wxid_a:\nhello', 1)).toBe('hello')
  })
  it('labels image / voice / video', () => {
    expect(parseMessageContent('<msg><img/></msg>', 3)).toBe('[图片]')
    expect(parseMessageContent('<voicemsg/>', 34)).toBe('[语音消息]')
    expect(parseMessageContent('<videomsg/>', 43)).toBe('[视频]')
  })
  it('parses a card', () => {
    expect(parseMessageContent('<msg nickname="小明"/>', 42)).toBe('[名片] 小明')
  })
  it('parses an app link (type 49 → 5)', () => {
    const xml = '<appmsg><title>Cool Article</title><type>5</type><url>https://x</url></appmsg>'
    expect(parseMessageContent(xml, 49)).toBe('[链接] Cool Article')
  })
  it('parses a file appmsg', () => {
    const xml = '<appmsg><title>report.pdf</title><type>6</type><totallen>1024</totallen></appmsg>'
    expect(parseMessageContent(xml, 49)).toBe('[文件] report.pdf')
  })
  it('parses a transfer', () => {
    const xml = '<appmsg><type>2000</type><wcpayinfo><feedesc>￥100.00</feedesc></wcpayinfo></appmsg>'
    expect(parseMessageContent(xml, 49)).toContain('[转账]')
  })
  it('cleans a system message', () => {
    expect(parseMessageContent('<sysmsg>你已添加了对方</sysmsg>', 10000)).toBe('你已添加了对方')
  })
  it('is resistant to nested escaped title xml', () => {
    const xml = '<appmsg><title>真实标题</title><type>5</type><des>正文里粘贴了 &lt;title&gt;假的&lt;/title&gt;</des></appmsg>'
    expect(parseMessageContent(xml, 49)).toBe('[链接] 真实标题')
  })
})

describe('media parsers', () => {
  it('parses image md5', () => {
    expect(parseImageInfo('<img aeskey="k" md5="ABCDEF"/>').md5).toBe('abcdef')
  })
  it('parses emoji info', () => {
    const info = parseEmojiInfo('<emoji md5="aa" cdnurl="https://a&amp;b" productid="p1"/>')
    expect(info.md5).toBe('aa')
    expect(info.cdnUrl).toBe('https://a&b')
    expect(info.productId).toBe('p1')
  })
  it('parses video duration and md5', () => {
    const xml = '<videomsg md5="0123456789abcdef0123456789abcdef" playlength="12"/>'
    expect(parseVideoDuration(xml)).toBe(12)
    expect(parseVideoMd5(xml)).toBe('0123456789abcdef0123456789abcdef')
  })
  it('parses voice duration ms', () => {
    expect(parseVoiceDurationMs('<voicemsg voicelength="3200"/>')).toBe(3200)
  })
  it('parses file info', () => {
    const info = parseFileInfo('<appmsg><type>6</type><title>a.txt</title><totallen>99</totallen><fileext>txt</fileext></appmsg>')
    expect(info).toMatchObject({ fileName: 'a.txt', fileSize: 99, fileExt: 'txt' })
  })
  it('parses link info', () => {
    expect(parseLinkInfo('<appmsg><title>T</title><url>https://u</url><des>D</des></appmsg>')).toEqual({ title: 'T', url: 'https://u', description: 'D' })
  })
})

describe('parseQuoteMessage', () => {
  it('extracts quoted text and sender, filtering wxid', () => {
    const xml =
      '<appmsg><type>57</type><refermsg><type>1</type><displayname>Alice</displayname><content>原始消息 wxid_zzz</content></refermsg></appmsg>'
    const quote = parseQuoteMessage(xml)
    expect(quote.sender).toBe('Alice')
    expect(quote.content).toBe('原始消息')
  })
  it('labels a quoted image', () => {
    const xml = '<refermsg><type>3</type><displayname>Bob</displayname><content>&lt;img md5="ff"/&gt;</content></refermsg>'
    const quote = parseQuoteMessage(xml)
    expect(quote.content).toBe('[图片]')
  })
})

describe('processSummary', () => {
  it('falls back to a type label when empty', () => {
    expect(processSummary('', 3)).toBe('[图片]')
    expect(processSummary('hi', 1)).toBe('hi')
  })
})
