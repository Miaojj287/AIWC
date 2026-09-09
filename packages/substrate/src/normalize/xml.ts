/**
 * Lite XML helpers for WeChat appmsg / refermsg payloads. Regex based on purpose: payloads are
 * small, often malformed, and we only ever need a handful of tags. No DOM, no dependency.
 */

export function decodeHtmlEntities(content: string): string {
  const decodeCodePoint = (value: string, radix: 10 | 16, fallback: string): string => {
    const cp = Number.parseInt(value, radix)
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return fallback
    try {
      return String.fromCodePoint(cp)
    } catch {
      return fallback
    }
  }
  return String(content ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => decodeCodePoint(hex, 16, m))
    .replace(/&#(\d+);/g, (m, dec: string) => decodeCodePoint(dec, 10, m))
    .replace(/&amp;/g, '&')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** First `<tag>…</tag>` body (CDATA unwrapped, trimmed). Empty string when absent. */
export function extractXmlValue(xml: string, tagName: string): string {
  if (!xml) return ''
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tagName)}>`, 'i')
  const m = re.exec(xml)
  if (!m) return ''
  return (m[1] ?? '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
}

/** `<tag … attr="value">` attribute value. Empty string when absent. */
export function extractXmlAttribute(xml: string, tagName: string, attrName: string): string {
  if (!xml) return ''
  const re = new RegExp(`<${escapeRegExp(tagName)}[^>]*?\\s${escapeRegExp(attrName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const m = re.exec(xml)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

export function stripXmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface XmlTextLite {
  /** appmsg <type> (57 quote, 5 link, 6 file, 2000 transfer …) */
  appType?: number
  title?: string
  desc?: string
  url?: string
  fileName?: string
  /** Quoted message when the payload is a refermsg. */
  quote?: { senderName?: string; text: string }
}

const WXID_LIKE = /^(wxid_[a-z0-9_-]+|[a-z0-9_-]+@(chatroom|openim|im\.chatroom))$/i

/** Extract the human readable parts of an appmsg payload ('link' / 'card' / 'quote' previews). */
export function extractTextFromXml(content: string): XmlTextLite {
  const raw = String(content ?? '')
  if (!raw.includes('<')) return {}
  const out: XmlTextLite = {}
  const typeText = extractXmlValue(raw, 'type')
  const appType = Number.parseInt(typeText, 10)
  if (Number.isFinite(appType)) out.appType = appType

  const title = decodeHtmlEntities(extractXmlValue(raw, 'title'))
  if (title) out.title = stripXmlTags(title)
  const desc = decodeHtmlEntities(extractXmlValue(raw, 'des') || extractXmlValue(raw, 'desc'))
  if (desc) out.desc = stripXmlTags(desc)
  const url = extractXmlValue(raw, 'url')
  if (url) out.url = decodeHtmlEntities(url)
  const fileName = extractXmlValue(raw, 'filename') || extractXmlAttribute(raw, 'appattach', 'filename')
  if (fileName) out.fileName = decodeHtmlEntities(fileName)

  const quote = parseQuote(raw)
  if (quote) out.quote = quote
  return out
}

/** refermsg → { senderName, text }. Returns undefined when the payload does not quote anything. */
export function parseQuote(content: string): { senderName?: string; text: string } | undefined {
  const raw = String(content ?? '')
  const start = raw.indexOf('<refermsg>')
  const end = raw.indexOf('</refermsg>')
  if (start === -1 || end === -1 || end < start) return undefined
  const refer = raw.slice(start, end + '</refermsg>'.length)
  let senderName: string | undefined = decodeHtmlEntities(extractXmlValue(refer, 'displayname'))
  if (!senderName || WXID_LIKE.test(senderName)) senderName = undefined
  const referType = extractXmlValue(refer, 'type')
  const referContent = decodeHtmlEntities(extractXmlValue(refer, 'content'))
  let text: string
  switch (referType) {
    case '3':
      text = '[图片]'
      break
    case '34':
      text = '[语音]'
      break
    case '43':
      text = '[视频]'
      break
    case '47':
      text = '[动画表情]'
      break
    case '49': {
      const inner = decodeHtmlEntities(extractXmlValue(referContent, 'title'))
      text = inner ? `[链接] ${stripXmlTags(inner)}` : '[链接]'
      break
    }
    default:
      text = stripSenderPrefix(referContent.includes('<') ? stripXmlTags(referContent) : referContent)
  }
  return senderName ? { senderName, text } : { text }
}

/** Group messages arrive as "wxid_xxx:\ntext"; drop the sender prefix. */
export function stripSenderPrefix(text: string): string {
  const s = String(text ?? '')
  const m = /^([a-zA-Z0-9_@.-]{3,64}):\s*\n/.exec(s)
  if (m && WXID_LIKE.test(m[1] ?? '')) return s.slice(m[0].length)
  return s
}
