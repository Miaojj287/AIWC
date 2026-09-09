import type { WxRichContent } from '@aiwc/protocol'
import { decodeHtmlEntities, extractXmlAttribute, extractXmlValue } from './rowDecoders'

const value = (xml: string, tag: string) => decodeHtmlEntities(extractXmlValue(xml, tag)).trim()
const attr = (xml: string, tag: string, name: string) => decodeHtmlEntities(extractXmlAttribute(xml, tag, name)).trim()
export function safeWebUrl(input: string): string | undefined {
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch { return undefined }
}
export function isPatMessage(xml: string): boolean {
  return /<patinfo(?:\s|>)/i.test(xml) || (/<appmsg(?:\s|>)/i.test(xml) && value(xml, 'type') === '62')
}
export function patText(xml: string): string {
  return value(xml, 'title') || value(xml, 'template') || '[拍一拍]'
}

export function parseRichContent(xml: string, baseType: number): WxRichContent | undefined {
  if (!xml || isPatMessage(xml)) return undefined
  if (baseType === 42) return { type: 'contact', title: attr(xml, 'msg', 'nickname') || '联系人', description: [attr(xml, 'msg', 'alias'), attr(xml, 'msg', 'province'), attr(xml, 'msg', 'city')].filter(Boolean).join(' · '), coverUrl: safeWebUrl(attr(xml, 'msg', 'bigheadimgurl') || attr(xml, 'msg', 'smallheadimgurl')) }
  if (baseType === 48) {
    const title = attr(xml, 'location', 'poiname') || '位置'
    const latitude = Number(attr(xml, 'location', 'x') || NaN)
    const longitude = Number(attr(xml, 'location', 'y') || NaN)
    return { type: 'location', title, description: attr(xml, 'location', 'label'), url: Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? `https://uri.amap.com/marker?position=${longitude},${latitude}&name=${encodeURIComponent(title)}` : undefined }
  }
  // Official-account pushes may contain several independent article items (local_type 285212721).
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => ({
    title: value(m[1]!, 'title'), description: value(m[1]!, 'digest'),
    url: safeWebUrl(value(m[1]!, 'url')), coverUrl: safeWebUrl(value(m[1]!, 'cover') || value(m[1]!, 'coverpic')),
  })).filter((item) => item.title && item.url)
  if (items.length && /<mmreader[\s>]/i.test(xml)) return { type: 'article', title: items[0]!.title, source: value(xml, 'name'), entries: items }
  if (baseType !== 49 && !/<appmsg[\s>]/i.test(xml)) return undefined
  const type = value(xml, 'type')
  if (['6', '57', '62'].includes(type)) return undefined
  const kinds: Record<string, WxRichContent['type']> = { '3': 'music', '19': 'chatHistory', '33': 'miniProgram', '36': 'miniProgram', '51': 'channel', '87': 'announcement', '115': 'gift', '2000': 'transfer', '2001': 'redPacket' }
  const url = safeWebUrl(value(xml, 'url'))
  const cover = value(xml, 'coverpicimageurl')
  const kind = kinds[type] ?? (cover || url?.includes('mp.weixin.qq.com/') ? 'article' : 'link')
  const rich: WxRichContent = {
    type: kind, title: value(xml, 'title') || '分享', description: value(xml, 'des').replace(/\\n/g, '\n'), url,
    coverUrl: safeWebUrl(cover || value(xml, 'thumburl') || value(xml, 'weapppagethumbrawurl')),
    source: value(xml, 'sourcedisplayname') || value(xml, 'appname'),
  }
  if (kind === 'announcement') { rich.title = '群公告'; rich.description = value(xml, 'textannouncement') || rich.description }
  if (kind === 'transfer') { rich.title = value(xml, 'pay_memo') || '微信转账'; rich.amount = value(xml, 'feedesc'); rich.status = ({ '1': '待收款', '3': '已收款', '4': '已退还' } as Record<string, string>)[value(xml, 'paysubtype')] || '转账' }
  if (kind === 'redPacket') { rich.title = value(xml, 'receivertitle') || value(xml, 'sendertitle') || '恭喜发财，大吉大利'; rich.description = '微信红包' }
  if (kind === 'gift') { rich.title = value(xml, 'skutitle') || '微信礼物'; rich.description = value(xml, 'wishmessage') }
  if (kind === 'channel') { const feed = extractXmlValue(xml, 'finderFeed'); rich.title = value(feed, 'desc') || '视频号视频'; rich.source = value(feed, 'nickname'); rich.coverUrl = safeWebUrl(value(feed, 'coverUrl') || value(feed, 'thumbUrl')) }
  if (kind === 'chatHistory') {
    const record = value(xml, 'recorditem')
    rich.entries = [...record.matchAll(/<dataitem(?:\s[^>]*)?>([\s\S]*?)<\/dataitem>/gi)].map((m) => ({ title: value(m[1]!, 'sourcename') || '消息', description: value(m[1]!, 'datadesc') || value(m[1]!, 'datatitle') || '[媒体消息]' }))
  }
  return rich
}
