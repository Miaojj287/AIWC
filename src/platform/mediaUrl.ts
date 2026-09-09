/**
 * Renderer-side media addressing. The substrate returns decrypted files as local paths; the main
 * process serves them through the `aiwc-media:` protocol (index.html CSP allows it). Data / blob /
 * http URLs (web mock, remote avatars) pass through untouched.
 */
const PASS_THROUGH = /^(data:|blob:|https?:|aiwc-media:)/i

export function toMediaUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (PASS_THROUGH.test(path)) return path
  const normalised = path.replace(/\\/g, '/')
  return `aiwc-media://${normalised.startsWith('/') ? '' : '/'}${encodeURI(normalised).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}
