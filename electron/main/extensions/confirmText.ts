/**
 * The text of the native "run this command?" confirmation (ipc/extensions.ts). It must show everything the
 * app will run: nothing hidden by invisible characters, nothing pushed out of view by whitespace, nothing
 * cut off. So the detail is normalised for display, and a command that would not fit the dialog whole is
 * refused instead of being shown truncated.
 */

/** Longest detail the dialog shows whole (after normalisation). */
export const MAX_CONFIRM_DETAIL_CHARS = 1_000
/** Most lines the dialog shows whole; a taller box runs off small screens. */
export const MAX_CONFIRM_DETAIL_LINES = 20

const isLineBreak = (cp: number): boolean => cp === 0x0a || cp === 0x2028 || cp === 0x2029
const isSpace = (cp: number): boolean =>
  cp === 0x20 ||
  cp === 0x09 ||
  cp === 0x0b ||
  cp === 0x0c ||
  cp === 0xa0 ||
  cp === 0x1680 ||
  (cp >= 0x2000 && cp <= 0x200a) ||
  cp === 0x202f ||
  cp === 0x205f ||
  cp === 0x3000

/** Controls, format characters (zero-width, bidi overrides), soft hyphen, variation selectors, fillers. */
const isInvisible = (cp: number): boolean =>
  cp < 0x20 ||
  (cp >= 0x7f && cp <= 0x9f) ||
  cp === 0xad ||
  cp === 0x061c ||
  cp === 0x115f ||
  cp === 0x1160 ||
  cp === 0x17b4 ||
  cp === 0x17b5 ||
  (cp >= 0x180b && cp <= 0x180f) ||
  (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x206f) ||
  cp === 0x3164 ||
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  cp === 0xfeff ||
  cp === 0xffa0 ||
  (cp >= 0xfff0 && cp <= 0xfffb) ||
  (cp >= 0xe0000 && cp <= 0xe0fff)

const visibleCodePoint = (cp: number): string => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`

/**
 * Display form of a command: CRLF / CR and Unicode line separators become one newline, runs of blank lines
 * one line break, runs of spaces one space, and every invisible character a visible `<U+XXXX>`.
 */
export function confirmationDetail(raw: string): string {
  const lines: string[] = []
  let line = ''
  let pendingSpace = false
  const flush = () => {
    if (line) lines.push(line)
    line = ''
    pendingSpace = false
  }
  for (const ch of raw.replace(/\r\n?/g, '\n')) {
    const cp = ch.codePointAt(0) ?? 0
    if (isLineBreak(cp)) flush()
    else if (isSpace(cp)) pendingSpace = line.length > 0
    else {
      if (pendingSpace) line += ' '
      pendingSpace = false
      line += isInvisible(cp) ? visibleCodePoint(cp) : ch
    }
  }
  flush()
  return lines.join('\n')
}

/** Whether `detail` (already normalised) fits the dialog whole. */
export function fitsConfirmation(detail: string): boolean {
  return detail.length <= MAX_CONFIRM_DETAIL_CHARS && detail.split('\n').length <= MAX_CONFIRM_DETAIL_LINES
}
