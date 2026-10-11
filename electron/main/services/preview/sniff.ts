/**
 * Content sniffing for file:read: a file whose extension maps to no known type (`.ts`, `.yaml`, `.log`…)
 * is still returned as text when its bytes are plainly UTF-8 text, instead of base64 the text view
 * would show as gibberish.
 */

/** Bytes inspected; enough to see a binary header or a NUL. */
const SNIFF_BYTES = 8192

/** True when the head of `buf` decodes as UTF-8 and holds no NUL / other C0 control bytes besides whitespace. */
export function looksLikeText(buf: Uint8Array): boolean {
  const head = buf.subarray(0, SNIFF_BYTES)
  for (const b of head) {
    if (b === 0) return false
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c && b !== 0x1b) return false
  }
  try {
    // A cut head may end inside a multi-byte character; streaming mode tolerates exactly that.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: head.length < buf.length })
    return true
  } catch {
    return false
  }
}
