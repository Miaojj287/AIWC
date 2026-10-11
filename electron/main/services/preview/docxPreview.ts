/**
 * .docx → read-only preview blocks (headings, paragraphs with bold / italic runs, list items, tables,
 * image placeholders). Parsed from word/document.xml plus styles.xml (which style ids are headings) and
 * numbering.xml (bullet vs numbered lists). The result is plain data the renderer turns into React, so
 * nothing in the document can ever run as markup. Size caps keep a huge document from stalling main.
 */
import type { DocBlock, DocRun, DocumentPreview } from '@aiwc/protocol'
import { isOn, xmlEvents } from './xml'
import { readOfficePart } from './officeZip'

/** Blocks kept before the preview stops (and says it was cut). */
const MAX_BLOCKS = 4000
/** Characters kept across all blocks. */
const MAX_CHARS = 400_000

interface StyleInfo {
  /** 1–3 when the style is a title / heading. */
  heading?: 1 | 2 | 3
}

const clampHeading = (n: number): 1 | 2 | 3 => (n <= 1 ? 1 : n === 2 ? 2 : 3)

/** styleId → heading level, from the style's name (`heading 2`, `Title`) or its outline level. */
export function parseStyles(xml: string | undefined): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>()
  if (!xml) return styles
  let id: string | undefined
  let info: StyleInfo = {}
  for (const e of xmlEvents(xml)) {
    if (e.type === 'open' && e.name === 'w:style') {
      id = e.attrs['w:styleId']
      info = {}
      if (e.selfClosing) id = undefined
    } else if (e.type === 'open' && id && e.name === 'w:name') {
      const name = (e.attrs['w:val'] ?? '').toLowerCase()
      const m = /^heading\s*(\d)$/.exec(name)
      if (m?.[1]) info.heading = clampHeading(Number(m[1]))
      else if (name === 'title') info.heading = 1
      else if (name === 'subtitle') info.heading = 2
    } else if (e.type === 'open' && id && e.name === 'w:outlineLvl' && info.heading === undefined) {
      const lvl = Number(e.attrs['w:val'])
      if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) info.heading = clampHeading(lvl + 1)
    } else if (e.type === 'close' && e.name === 'w:style' && id) {
      styles.set(id, info)
      id = undefined
    }
  }
  return styles
}

/** numId → (ilvl → ordered?), from numbering.xml: anything but a bullet format counts as ordered. */
export function parseNumbering(xml: string | undefined): (numId: string, level: number) => boolean {
  if (!xml) return () => false
  const abstractFormats = new Map<string, Map<number, string>>()
  const numToAbstract = new Map<string, string>()
  let abstractId: string | undefined
  let level = 0
  let numId: string | undefined
  for (const e of xmlEvents(xml)) {
    if (e.type === 'open') {
      if (e.name === 'w:abstractNum') {
        abstractId = e.attrs['w:abstractNumId']
        if (abstractId) abstractFormats.set(abstractId, new Map())
      } else if (e.name === 'w:lvl') level = Number(e.attrs['w:ilvl'] ?? 0)
      else if (e.name === 'w:numFmt' && abstractId) abstractFormats.get(abstractId)?.set(level, e.attrs['w:val'] ?? '')
      else if (e.name === 'w:num') numId = e.attrs['w:numId']
      else if (e.name === 'w:abstractNumId' && numId && e.attrs['w:val']) numToAbstract.set(numId, e.attrs['w:val'])
    } else if (e.type === 'close' && e.name === 'w:abstractNum') abstractId = undefined
  }
  return (id, lvl) => {
    const abstract = numToAbstract.get(id)
    const fmt = abstract ? abstractFormats.get(abstract)?.get(lvl) : undefined
    return fmt !== undefined && fmt !== 'bullet' && fmt !== 'none'
  }
}

interface ParagraphState {
  runs: DocRun[]
  styleId?: string
  numId?: string
  level: number
  hasImage: boolean
}

/** Append text to the runs, merging with the previous run when the styling matches. */
function pushRun(runs: DocRun[], text: string, bold: boolean, italic: boolean): void {
  if (!text) return
  const last = runs[runs.length - 1]
  if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) {
    last.text += text
    return
  }
  runs.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) })
}

const runsText = (runs: DocRun[]): string => runs.map((r) => r.text).join('')

/** Parse the body of word/document.xml into blocks. */
export function parseDocumentXml(
  xml: string,
  styles: Map<string, StyleInfo>,
  isOrdered: (numId: string, level: number) => boolean,
): { blocks: DocBlock[]; truncated: boolean } {
  const blocks: DocBlock[] = []
  let chars = 0
  let truncated = false
  // Tables nest; only the outermost becomes a block, inner ones flatten into its cell text.
  const tables: { rows: string[][]; cell?: string[] }[] = []
  let para: ParagraphState | undefined
  let inRunProps = false
  let inParaProps = false
  let bold = false
  let italic = false
  let inText = false

  const emit = (block: DocBlock, size: number) => {
    if (blocks.length >= MAX_BLOCKS || chars + size > MAX_CHARS) {
      truncated = true
      return
    }
    chars += size
    blocks.push(block)
  }

  const closeParagraph = (p: ParagraphState) => {
    const text = runsText(p.runs)
    const table = tables[tables.length - 1]
    if (table?.cell) {
      if (text.trim()) table.cell.push(text)
      return
    }
    if (p.hasImage) emit({ type: 'image' }, 1)
    if (!text.trim()) return
    const heading = p.styleId ? styles.get(p.styleId)?.heading : undefined
    if (heading) emit({ type: 'heading', level: heading, runs: p.runs }, text.length)
    else if (p.numId && p.numId !== '0')
      emit({ type: 'listItem', level: p.level, ordered: isOrdered(p.numId, p.level), runs: p.runs }, text.length)
    else emit({ type: 'paragraph', runs: p.runs }, text.length)
  }

  for (const e of xmlEvents(xml)) {
    if (truncated) break
    if (e.type === 'text') {
      if (inText && para) pushRun(para.runs, e.text, bold, italic)
      continue
    }
    if (e.type === 'open') {
      switch (e.name) {
        case 'w:tbl':
          tables.push({ rows: [] })
          break
        case 'w:tr':
          tables[tables.length - 1]?.rows.push([])
          break
        case 'w:tc': {
          const table = tables[tables.length - 1]
          if (table) table.cell = []
          break
        }
        case 'w:p':
          if (!e.selfClosing) para = { runs: [], level: 0, hasImage: false }
          break
        case 'w:pStyle':
          if (para) para.styleId = e.attrs['w:val']
          break
        case 'w:numId':
          if (para) para.numId = e.attrs['w:val']
          break
        case 'w:ilvl':
          if (para) para.level = Math.max(0, Math.min(8, Number(e.attrs['w:val'] ?? 0) || 0))
          break
        case 'w:r':
          bold = false
          italic = false
          break
        case 'w:pPr':
          inParaProps = !e.selfClosing
          break
        case 'w:rPr':
          inRunProps = !e.selfClosing
          break
        case 'w:b':
          if (inRunProps) bold = isOn(e.attrs, 'w:val')
          break
        case 'w:i':
          if (inRunProps) italic = isOn(e.attrs, 'w:val')
          break
        case 'w:t':
          inText = !e.selfClosing
          break
        case 'w:tab':
          // <w:tabs><w:tab/> inside the paragraph properties are tab stops, not characters.
          if (para && !inParaProps) pushRun(para.runs, '\t', bold, italic)
          break
        case 'w:br':
        case 'w:cr':
          if (para) pushRun(para.runs, '\n', bold, italic)
          break
        case 'w:drawing':
        case 'w:pict':
          if (para) para.hasImage = true
          break
      }
      continue
    }
    switch (e.name) {
      case 'w:t':
        inText = false
        break
      case 'w:rPr':
        inRunProps = false
        break
      case 'w:pPr':
        inParaProps = false
        break
      case 'w:p':
        if (para) closeParagraph(para)
        para = undefined
        break
      case 'w:tc': {
        const table = tables[tables.length - 1]
        if (table?.cell) {
          table.rows[table.rows.length - 1]?.push(table.cell.join('\n'))
          table.cell = undefined
        }
        break
      }
      case 'w:tbl': {
        const table = tables.pop()
        if (!table) break
        const parent = tables[tables.length - 1]
        const flat = table.rows.map((r) => r.join(' | ')).join('\n')
        if (parent?.cell) {
          if (flat.trim()) parent.cell.push(flat)
        } else if (table.rows.some((r) => r.some((c) => c.trim()))) {
          emit({ type: 'table', rows: table.rows }, flat.length)
        }
        break
      }
    }
  }
  return { blocks, truncated }
}

/** Parse a .docx file. Throws (localized) when it is not a readable Word document. */
export function previewDocx(file: Buffer): DocumentPreview {
  const document = readOfficePart(file, 'word/document.xml', true)
  const styles = parseStyles(readOfficePart(file, 'word/styles.xml'))
  const numbering = parseNumbering(readOfficePart(file, 'word/numbering.xml'))
  const { blocks, truncated } = parseDocumentXml(document, styles, numbering)
  return { kind: 'docx', blocks, truncated }
}
