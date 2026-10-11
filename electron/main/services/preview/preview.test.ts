import { describe, expect, it, vi } from 'vitest'
import { buildZip } from '../zipTestUtil'
import { previewDocx } from './docxPreview'
import { columnIndex, formatExcelDate, isDateFormatCode, previewXlsx } from './xlsxPreview'
import { looksLikeText } from './sniff'
import { decodeXmlEntities, xmlEvents } from './xml'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function docx(body: string, extra: { styles?: string; numbering?: string } = {}): Buffer {
  return buildZip([
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
      deflate: true,
    },
    ...(extra.styles ? [{ name: 'word/styles.xml', data: `<w:styles ${W}>${extra.styles}</w:styles>` }] : []),
    ...(extra.numbering
      ? [{ name: 'word/numbering.xml', data: `<w:numbering ${W}>${extra.numbering}</w:numbering>` }]
      : []),
  ])
}

const p = (inner: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`
const r = (text: string, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`

describe('xml tokenizer', () => {
  it('yields tags, attributes and decoded text, skipping comments and declarations', () => {
    const events = [...xmlEvents('<?xml?><!-- c --><a x="1 &amp; 2"><b/>t&lt;&#x4E2D;</a>')]
    expect(events).toEqual([
      { type: 'open', name: 'a', attrs: { x: '1 & 2' }, selfClosing: false },
      { type: 'open', name: 'b', attrs: {}, selfClosing: true },
      { type: 'text', text: 't<中' },
      { type: 'close', name: 'a' },
    ])
    expect(decodeXmlEntities('&bogus; &#0;')).toBe('&bogus; &#0;')
  })
})

describe('previewDocx', () => {
  it('keeps headings (by style name), styled runs, lists and tables', () => {
    const styles =
      '<w:style w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Body"><w:name w:val="Normal"/></w:style>'
    const numbering =
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num>'
    const body = [
      p(r('周报'), '<w:pStyle w:val="1"/>'),
      p(r('普通') + r('加粗', '<w:b/>') + r('不加粗', '<w:b w:val="0"/>')),
      p(r('第一项'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr>'),
      p(r('圆点'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="6"/></w:numPr>'),
      p(''),
      `<w:tbl><w:tr><w:tc>${p(r('A1'))}</w:tc><w:tc>${p(r('B1'))}</w:tc></w:tr><w:tr><w:tc>${p(r('A2'))}${p(r('续'))}</w:tc><w:tc/></w:tr></w:tbl>`,
      p('<w:r><w:drawing/></w:r>'),
    ].join('')
    const out = previewDocx(docx(body, { styles, numbering }))
    expect(out).toEqual({
      kind: 'docx',
      truncated: false,
      blocks: [
        { type: 'heading', level: 1, runs: [{ text: '周报' }] },
        { type: 'paragraph', runs: [{ text: '普通' }, { text: '加粗', bold: true }, { text: '不加粗' }] },
        { type: 'listItem', level: 0, ordered: true, runs: [{ text: '第一项' }] },
        { type: 'listItem', level: 0, ordered: false, runs: [{ text: '圆点' }] },
        { type: 'table', rows: [['A1', 'B1'], ['A2\n续']] },
        { type: 'image' },
      ],
    })
  })

  it('does not turn tab stops in paragraph properties into text', () => {
    const out = previewDocx(
      docx(p(r('a') + '<w:r><w:tab/></w:r>' + r('b'), '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>')),
    )
    expect(out.kind === 'docx' && out.blocks).toEqual([{ type: 'paragraph', runs: [{ text: 'a\tb' }] }])
  })

  it('rejects something that is not a Word package', () => {
    expect(() => previewDocx(Buffer.from('not a zip'))).toThrow('main.data.previewUnreadable')
    expect(() => previewDocx(buildZip([{ name: 'x.txt', data: 'x' }]))).toThrow('main.data.previewUnreadable')
  })
})

function xlsx(
  sheets: { name: string; xml: string; state?: string }[],
  extra: { shared?: string; styles?: string; date1904?: boolean } = {},
): Buffer {
  const workbook = `<workbook><workbookPr${extra.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
    .map(
      (s, i) =>
        `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.state ? ` state="${s.state}"` : ''}/>`,
    )
    .join('')}</sheets></workbook>`
  const rels = `<Relationships>${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}</Relationships>`
  return buildZip([
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: `<worksheet><sheetData>${s.xml}</sheetData></worksheet>`,
      deflate: true,
    })),
    ...(extra.shared ? [{ name: 'xl/sharedStrings.xml', data: `<sst>${extra.shared}</sst>` }] : []),
    ...(extra.styles ? [{ name: 'xl/styles.xml', data: `<styleSheet>${extra.styles}</styleSheet>` }] : []),
  ])
}

describe('previewXlsx', () => {
  it('reads shared / inline strings, numbers, booleans, dates and skips hidden sheets', () => {
    const shared = '<si><t>名称</t></si><si><r><t>数</t></r><r><t>量</t></r><rPh><t>ignored</t></rPh></si>'
    const styles =
      '<numFmts><numFmt numFmtId="164" formatCode="yyyy/mm/dd"/><numFmt numFmtId="165" formatCode="0.00&quot;d&quot;"/></numFmts>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="165"/></cellXfs>'
    const sheet =
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>苹果</t></is></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>3.5</v></c></row>' +
      '<row r="3"><c r="A3" s="1"><v>45658</v></c><c r="B3" s="2"><v>45658.5</v></c><c r="C3" s="3"><v>2</v></c></row>' +
      '<row r="9"><c r="A9"/></row>'
    const out = previewXlsx(
      xlsx(
        [
          { name: '表一', xml: sheet },
          { name: '隐藏', xml: '', state: 'hidden' },
        ],
        { shared, styles },
      ),
    )
    expect(out).toEqual({
      kind: 'xlsx',
      sheets: [
        {
          name: '表一',
          truncated: false,
          rows: [
            ['名称', '', '数量'],
            ['苹果', 'TRUE', '3.5'],
            ['2025-01-01', '2025-01-01 12:00', '2'],
          ],
        },
      ],
    })
  })

  it('caps rows and says so', () => {
    const rows = Array.from(
      { length: 1005 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join('')
    const out = previewXlsx(xlsx([{ name: 'big', xml: rows }]))
    expect(out.kind === 'xlsx' && out.sheets[0]?.rows.length).toBe(1000)
    expect(out.kind === 'xlsx' && out.sheets[0]?.truncated).toBe(true)
  })

  it('parses a part that several sheets point at only once', () => {
    const many = Array.from({ length: 20 }, (_, i) => `<sheet name="s${i}" sheetId="${i + 1}" r:id="rId1"/>`).join('')
    const file = buildZip([
      { name: 'xl/workbook.xml', data: `<workbook><sheets>${many}</sheets></workbook>` },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
      },
    ])
    const out = previewXlsx(file)
    expect(out.kind === 'xlsx' && out.sheets.map((s) => s.name)).toEqual(['s0'])
  })

  it('refuses a small file whose parts would inflate past the preview caps, before inflating them', () => {
    const zeros = (mb: number) => Buffer.alloc(mb * 1024 * 1024, 0x20)
    const sheetXml = (n: number) => ({ name: `s${n}`, xml: '' })
    const bomb = xlsx([sheetXml(1)])
    // One oversized part (declared 30 MB, a few KB on disk).
    const huge = buildZip([
      {
        name: 'xl/workbook.xml',
        data: '<workbook><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      },
      { name: 'xl/worksheets/sheet1.xml', data: zeros(30), deflate: true },
    ])
    expect(huge.length).toBeLessThan(1024 * 1024)
    expect(() => previewXlsx(huge)).toThrow('main.data.previewTooLarge')
    // Parts each under the per-part cap, together over the per-preview budget.
    const spread = buildZip([
      {
        name: 'xl/workbook.xml',
        data: '<workbook><sheets><sheet name="a" sheetId="1" r:id="rId1"/><sheet name="b" sheetId="2" r:id="rId2"/></sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      },
      { name: 'xl/sharedStrings.xml', data: zeros(20), deflate: true },
      { name: 'xl/worksheets/sheet1.xml', data: zeros(20), deflate: true },
      { name: 'xl/worksheets/sheet2.xml', data: zeros(20), deflate: true },
    ])
    expect(() => previewXlsx(spread)).toThrow('main.data.previewTooLarge')
    expect(() => previewXlsx(bomb)).not.toThrow()
  })

  it('a part that inflates past the size it declares is unreadable, not expanded', () => {
    const file = xlsx([{ name: 'a', xml: '<row r="1"><c r="A1"><v>1</v></c></row>'.repeat(50) }])
    // Shrink the declared size of the deflated sheet in its central directory entry.
    const dirSig = file.lastIndexOf(Buffer.from('xl/worksheets/sheet1.xml')) - 46
    expect(file.readUInt32LE(dirSig)).toBe(0x02014b50)
    file.writeUInt32LE(10, dirSig + 24)
    expect(() => previewXlsx(file)).toThrow('main.data.previewUnreadable')
  })

  it('helpers: column letters, date formats, 1904 system', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('AB12')).toBe(27)
    expect(columnIndex('12')).toBe(-1)
    expect(isDateFormatCode('yyyy-mm-dd hh:mm')).toBe(true)
    expect(isDateFormatCode('#,##0.00')).toBe(false)
    expect(isDateFormatCode('0.00"days"')).toBe(false)
    expect(formatExcelDate(0, true)).toBe('1904-01-01')
  })
})

describe('looksLikeText', () => {
  it('accepts UTF-8 text and rejects binary', () => {
    expect(looksLikeText(Buffer.from('const a = "中文"\n'))).toBe(true)
    expect(looksLikeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe(false)
    expect(looksLikeText(Buffer.from([0xff, 0xfe, 0x41]))).toBe(false)
    // A head cut inside a multi-byte character is still text.
    const long = Buffer.from('中'.repeat(4000))
    expect(looksLikeText(long)).toBe(true)
  })
})
