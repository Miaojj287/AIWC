import { describe, expect, it } from 'vitest'
import { classifyKind, sessionKindFromUsername, splitLocalType, isSystemUsername, contactKindFromUsername } from './kinds'
import { extractTextFromXml, parseQuote, stripSenderPrefix, extractXmlAttribute, decodeHtmlEntities } from './xml'
import { previewText } from './preview'

describe('sessionKindFromUsername', () => {
  it('maps chatroom / gh_ / system / dm', () => {
    expect(sessionKindFromUsername('12345@chatroom')).toBe('group')
    expect(sessionKindFromUsername('gh_abc123')).toBe('official')
    expect(sessionKindFromUsername('brandservicesessionholder')).toBe('system')
    expect(sessionKindFromUsername('notification_messages')).toBe('system')
    expect(sessionKindFromUsername('service_xyz')).toBe('system')
    expect(sessionKindFromUsername('abc@kefu.openim')).toBe('system')
    expect(sessionKindFromUsername('wxid_abc')).toBe('dm')
    expect(sessionKindFromUsername('someone@openim')).toBe('dm')
    expect(isSystemUsername('')).toBe(true)
    expect(contactKindFromUsername('wxid_x', { isFriend: false })).toBe('stranger')
  })
})

describe('classifyKind', () => {
  it('maps base local types', () => {
    expect(classifyKind({ localType: 1 })).toBe('text')
    expect(classifyKind({ localType: 3 })).toBe('image')
    expect(classifyKind({ localType: 34 })).toBe('voice')
    expect(classifyKind({ localType: 43 })).toBe('video')
    expect(classifyKind({ localType: 47 })).toBe('sticker')
    expect(classifyKind({ localType: 48 })).toBe('location')
    expect(classifyKind({ localType: 42 })).toBe('card')
    expect(classifyKind({ localType: 10000, content: '你已添加了对方' })).toBe('system')
    expect(classifyKind({ localType: 10002, content: '<sysmsg type="revokemsg">' })).toBe('revoke')
  })
  it('splits packed v4 local types and sniffs appmsg subtypes', () => {
    expect(splitLocalType(244813135921)).toEqual({ base: 49, appType: 57 })
    expect(classifyKind({ localType: 244813135921 })).toBe('quote')
    expect(classifyKind({ localType: 49, content: '<msg><appmsg><type>6</type></appmsg></msg>' })).toBe('file')
    expect(classifyKind({ localType: 49, content: '<msg><appmsg><type>5</type></appmsg></msg>' })).toBe('link')
    expect(classifyKind({ localType: 49, content: '<msg><appmsg><type>2000</type></appmsg></msg>' })).toBe('transfer')
    expect(classifyKind({ localType: 49, content: '<msg><appmsg><type>57</type></appmsg></msg>' })).toBe('quote')
    expect(classifyKind({ localType: 9999 })).toBe('other')
  })
})

describe('xml lite', () => {
  const quoteXml =
    '<msg><appmsg><title>回复：好的</title><type>57</type><refermsg><type>1</type><displayname>张三</displayname><content>wxid_abc:\n今天下午三点开会</content></refermsg></appmsg></msg>'
  it('parses refermsg', () => {
    expect(parseQuote(quoteXml)).toEqual({ senderName: '张三', text: '今天下午三点开会' })
    expect(parseQuote('plain text')).toBeUndefined()
  })
  it('extracts title/desc/url and app type', () => {
    const r = extractTextFromXml('<msg><appmsg><title>产品市场周报 &amp; 复盘</title><des>第 12 周</des><url>https://example.com/a?b=1&amp;c=2</url><type>5</type></appmsg></msg>')
    expect(r.title).toBe('产品市场周报 & 复盘')
    expect(r.desc).toBe('第 12 周')
    expect(r.url).toBe('https://example.com/a?b=1&c=2')
    expect(r.appType).toBe(5)
    expect(extractTextFromXml('hello')).toEqual({})
  })
  it('strips sender prefix and reads attributes', () => {
    expect(stripSenderPrefix('wxid_abc123:\n你好')).toBe('你好')
    expect(stripSenderPrefix('注意: 不是前缀')).toBe('注意: 不是前缀')
    expect(extractXmlAttribute('<msg><img md5="abc" length="12"/></msg>', 'img', 'md5')).toBe('abc')
    expect(decodeHtmlEntities('&lt;b&gt; &#x4e2d; &#25991;')).toBe('<b> 中 文')
  })
})

describe('previewText', () => {
  it('produces Chinese labels without emoji', () => {
    expect(previewText('image', '')).toBe('[图片]')
    expect(previewText('voice', '', { kind: 'voice', transcript: '喂 你好' })).toBe('[语音] 喂 你好')
    expect(previewText('file', '', { kind: 'file', fileName: '报告.pdf' })).toBe('[文件] 报告.pdf')
    expect(previewText('text', 'a\n\n b   c')).toBe('a b c')
    expect(previewText('text', 'x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})
