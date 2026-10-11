/**
 * Pure helpers for the file Tab: naming, extension → preview kind, how each kind is loaded. No DOM.
 */
import { extensionOf, type PreviewKind } from '@/platform/filePreview'

export { extensionOf, fileName, isMarkdownFile, parentDir, previewKind, type PreviewKind } from '@/platform/filePreview'

/**
 * How the Tab gets a kind's content: `read` = file:read (text or base64), `document` = file:previewDocument
 * (parsed Office file), `stream` = the aiwc-media URL (audio / video play with range requests), `none` = a
 * known binary format there is no point reading (archives, installers, legacy Office).
 */
export type PreviewSource = 'read' | 'document' | 'stream' | 'none'

/** Dirty = the draft differs from what was loaded (line endings normalised). */
export function isDirty(loaded: string | undefined, draft: string): boolean {
  if (loaded === undefined) return false
  return loaded.replace(/\r\n/g, '\n') !== draft.replace(/\r\n/g, '\n')
}

/** Word / char count line for the status area: 1,284 字 · 32 行 */
export function contentStats(text: string): { chars: number; lines: number } {
  return { chars: Array.from(text.replace(/\s+/g, '')).length, lines: text.length === 0 ? 0 : text.split('\n').length }
}

/** Extensions that are certainly binary and not previewable: the Tab offers the default app without reading. */
const KNOWN_BINARY_EXT = new Set([
  'zip',
  'rar',
  '7z',
  'gz',
  'tar',
  'dmg',
  'exe',
  'msi',
  'pkg',
  'apk',
  'doc',
  'xls',
  'ppt',
  'pptx',
  'key',
  'numbers',
  'pages',
])

/** How content for `kind` is loaded (see PreviewSource); `path` lets known binaries skip the read. */
export function previewSource(kind: PreviewKind, path?: string): PreviewSource {
  if (kind === 'unsupported' && path && KNOWN_BINARY_EXT.has(extensionOf(path))) return 'none'
  switch (kind) {
    case 'markdown':
    case 'text':
    case 'csv':
    case 'html':
    case 'image':
    case 'pdf':
      return 'read'
    case 'docx':
    case 'xlsx':
      return 'document'
    case 'audio':
    case 'video':
      return 'stream'
    case 'unsupported':
      return 'read'
  }
}

/**
 * file:read returns binaries as bare base64 (no `data:` prefix). An <img> needs a data URL: build it from
 * the media type, and pass a value that already is one through unchanged.
 */
export function toDataUrl(content: string, mediaType: string): string {
  if (content.startsWith('data:')) return content
  const type = mediaType.split(';')[0]?.trim() || 'application/octet-stream'
  if (type === 'image/svg+xml' && !looksLikeBase64(content))
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
  return `data:${type};base64,${content}`
}

const looksLikeBase64 = (s: string): boolean => /^[A-Za-z0-9+/\s]*={0,2}$/.test(s.slice(0, 256))

/** Base64 (as file:read returns binaries) → bytes, for the PDF viewer. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Content-Security-Policy put in front of a previewed HTML file: no scripts, no network, inline styles only. */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; form-action 'none'"

/**
 * The HTML file as an isolated document for a sandboxed <iframe srcdoc>: the sandbox already blocks
 * scripts, forms and top navigation; the CSP meta additionally blocks every network request (remote
 * images, stylesheets, fonts), so opening a file never phones home.
 */
export function isolatedHtml(source: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><base target="_blank">${source}`
}
