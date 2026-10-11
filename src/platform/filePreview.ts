/**
 * What the file Tab can preview, decided from a file name (and, once read, its media type). Shared so other
 * functions (a chat file message) can tell whether 预览 is worth offering before opening the Tab. Pure.
 */
export type PreviewKind =
  'markdown' | 'text' | 'csv' | 'html' | 'image' | 'pdf' | 'audio' | 'video' | 'docx' | 'xlsx' | 'unsupported'

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
const TEXT_EXT = new Set([
  'txt',
  'json',
  'log',
  'yaml',
  'yml',
  'toml',
  'xml',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'sh',
  'sql',
  'ini',
  'conf',
  'env',
])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
const CSV_EXT = new Set(['csv', 'tsv'])
const HTML_EXT = new Set(['html', 'htm'])
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'])
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm'])

export function isMarkdownFile(path: string, mediaType?: string): boolean {
  return MARKDOWN_EXT.has(extensionOf(path)) || mediaType === 'text/markdown'
}

/** What the Tab renders for a file, from its extension (and the media type once loaded). */
export function previewKind(path: string, mediaType?: string): PreviewKind {
  if (isMarkdownFile(path, mediaType)) return 'markdown'
  const ext = extensionOf(path)
  if (IMAGE_EXT.has(ext) || mediaType?.startsWith('image/')) return 'image'
  if (CSV_EXT.has(ext) || mediaType?.startsWith('text/csv')) return 'csv'
  if (HTML_EXT.has(ext) || mediaType?.startsWith('text/html')) return 'html'
  if (ext === 'pdf' || mediaType === 'application/pdf') return 'pdf'
  if (AUDIO_EXT.has(ext) || mediaType?.startsWith('audio/')) return 'audio'
  if (VIDEO_EXT.has(ext) || mediaType?.startsWith('video/')) return 'video'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx') return 'xlsx'
  if (
    TEXT_EXT.has(ext) ||
    mediaType?.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/xml'
  )
    return 'text'
  return 'unsupported'
}
