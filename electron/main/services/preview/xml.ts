/**
 * A forgiving pull tokenizer for the OOXML parts the Office previews read (document.xml, sheet XML,
 * shared strings). Not a validating parser: it yields open / close / text events, skips comments,
 * processing instructions and doctype, and decodes the five named entities plus numeric references.
 * Good enough for machine-written Office XML; never used on markup that is rendered.
 */

export type XmlEvent =
  | { type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string }

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Decode XML entities; an unknown or malformed reference is kept as written. */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#')) {
      const code = body.startsWith('#x') ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[body] ?? whole
  })
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function parseTag(raw: string): XmlEvent | undefined {
  if (raw.startsWith('/')) return { type: 'close', name: raw.slice(1).trim() }
  const selfClosing = raw.endsWith('/')
  const body = selfClosing ? raw.slice(0, -1) : raw
  const nameEnd = body.search(/\s/)
  const name = nameEnd < 0 ? body : body.slice(0, nameEnd)
  if (!name) return undefined
  const attrs: Record<string, string> = {}
  if (nameEnd >= 0) {
    for (const m of body.slice(nameEnd).matchAll(ATTR)) {
      const key = m[1]
      if (key) attrs[key] = decodeXmlEntities(m[2] ?? m[3] ?? '')
    }
  }
  return { type: 'open', name, attrs, selfClosing }
}

/** Tokenize `xml` into events, in document order. */
export function* xmlEvents(xml: string): Generator<XmlEvent> {
  let i = 0
  const n = xml.length
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      const text = xml.slice(i)
      if (text) yield { type: 'text', text: decodeXmlEntities(text) }
      return
    }
    if (lt > i) yield { type: 'text', text: decodeXmlEntities(xml.slice(i, lt)) }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      const text = xml.slice(lt + 9, end < 0 ? n : end)
      if (text) yield { type: 'text', text }
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2)
      i = end < 0 ? n : end + 1
      continue
    }
    const gt = xml.indexOf('>', lt + 1)
    if (gt < 0) return
    const event = parseTag(xml.slice(lt + 1, gt).trim())
    if (event) yield event
    i = gt + 1
  }
}

/** True when an OOXML on/off property (`<w:b/>`, `<w:b w:val="0"/>`) is on. */
export function isOn(attrs: Record<string, string>, valAttr: string): boolean {
  const v = attrs[valAttr]
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v.toLowerCase())
}
