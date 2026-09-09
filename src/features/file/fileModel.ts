/**
 * Pure helpers for the file Tab: naming, extension → preview kind. No DOM.
 */
export type PreviewKind = 'markdown' | 'text' | 'image' | 'unsupported'

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx > 0 ? path.slice(0, idx) : ''
}

export function extensionOf(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx'])
const TEXT_EXT = new Set(['txt', 'json', 'csv', 'log', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'sql', 'ini', 'conf', 'env'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

export function isMarkdownFile(path: string, mediaType?: string): boolean {
  return MARKDOWN_EXT.has(extensionOf(path)) || mediaType === 'text/markdown'
}

/** What the Tab renders for a file: editor+preview / read-only text / image / unsupported. */
export function previewKind(path: string, mediaType?: string): PreviewKind {
  if (isMarkdownFile(path, mediaType)) return 'markdown'
  const ext = extensionOf(path)
  if (IMAGE_EXT.has(ext) || mediaType?.startsWith('image/')) return 'image'
  if (TEXT_EXT.has(ext) || mediaType?.startsWith('text/') || mediaType === 'application/json' || mediaType === 'application/xml') return 'text'
  return 'unsupported'
}

/** Dirty = the draft differs from what was loaded (line endings normalised). */
export function isDirty(loaded: string | undefined, draft: string): boolean {
  if (loaded === undefined) return false
  return loaded.replace(/\r\n/g, '\n') !== draft.replace(/\r\n/g, '\n')
}

/** Word / char count line for the status area: 1,284 字 · 32 行 */
export function contentStats(text: string): { chars: number; lines: number } {
  return { chars: Array.from(text.replace(/\s+/g, '')).length, lines: text.length === 0 ? 0 : text.split('\n').length }
}
