/**
 * pdf.js wiring for the file Tab, imported lazily (PdfPreview) so the ~1.6 MB library and its worker
 * load only when a PDF is opened. The predefined CMaps (CJK PDFs whose fonts only name a CMap) and the
 * standard 14 font files come from pdfjs-dist through Vite asset URLs; nothing is fetched from the
 * network, and pdf.js 5 needs no `eval`, so the page's CSP stays as it is.
 */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { base64ToBytes } from './fileModel'

GlobalWorkerOptions.workerSrc = workerUrl

/** pdf.js only asks the factory when these options are set; the value itself is never fetched. */
const ASSET_BASE = 'bundled:'

const CMAP_URLS = import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url',
  import: 'default',
  eager: true,
})
const FONT_URLS = import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url',
  import: 'default',
  eager: true,
})

const byFileName = (urls: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]))
const CMAPS = byFileName(CMAP_URLS)
const FONTS = byFileName(FONT_URLS)

/**
 * pdf.js's `BinaryDataFactory` contract (constructed with the URL options, asked for one file at a time):
 * answers from the bundled asset URLs instead of a URL prefix.
 */
class BundledDataFactory {
  constructor(_options: unknown) {}

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const table = kind === 'cMapUrl' ? CMAPS : kind === 'standardFontDataUrl' ? FONTS : undefined
    const resolved = table?.get(filename)
    if (!resolved) throw new Error(`missing pdf asset ${filename}`)
    // Small files are inlined by Vite as data: URLs; decode those here (the page CSP has no data: in connect-src).
    if (resolved.startsWith('data:')) return base64ToBytes(resolved.slice(resolved.indexOf(',') + 1))
    const res = await fetch(resolved)
    return new Uint8Array(await res.arrayBuffer())
  }
}

/** Open a PDF from its bytes. The caller owns the result and must `destroy()` it. */
export function openPdf(data: Uint8Array): { promise: Promise<PDFDocumentProxy>; cancel: () => void } {
  const task = getDocument({
    // pdf.js transfers the buffer to its worker; hand it a copy so the caller's bytes stay usable.
    data: data.slice(),
    cMapUrl: ASSET_BASE,
    cMapPacked: true,
    standardFontDataUrl: ASSET_BASE,
    useWorkerFetch: false,
    BinaryDataFactory: BundledDataFactory,
  })
  return { promise: task.promise, cancel: () => void task.destroy() }
}

export type { PDFDocumentProxy }
