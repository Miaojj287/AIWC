/**
 * Reading what the CLIs print. They mix human lines, ASCII QR codes and JSON on the same streams, so
 * JSON is located rather than assumed, and URLs are pulled from free text.
 */

/** The JSON document in `text`: the whole trimmed text, else the first `{`/`[` that parses to the end of a balanced block. */
export function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    /* mixed output — scan */
  }
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch !== '{' && ch !== '[') continue
    const end = matchingClose(trimmed, i)
    if (end < 0) continue
    try {
      return JSON.parse(trimmed.slice(i, end + 1))
    } catch {
      /* not JSON at this brace */
    }
  }
  return undefined
}

/** Index of the bracket closing the one at `start`, honouring strings; -1 when unbalanced. */
function matchingClose(text: string, start: number): number {
  const stack: string[] = []
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

const URL_RE = /https?:\/\/[^\s"'<>`　-〿＀-￯]+/g

/** Every http(s) URL in `text`, trailing punctuation removed, in order of appearance, de-duplicated. */
export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[),.;:!?\]}]+$/, '')
    if (!out.includes(url)) out.push(url)
  }
  return out
}

/** Depth-first search for the first string value under any of `keys`. */
export function findString(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 8 || value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findString(item, keys, depth + 1)
      if (hit) return hit
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const v = record[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  for (const v of Object.values(record)) {
    const hit = findString(v, keys, depth + 1)
    if (hit) return hit
  }
  return undefined
}

/** Depth-first search for the first array under any of `keys`. */
export function findArray(value: unknown, keys: readonly string[], depth = 0): unknown[] | undefined {
  if (depth > 8 || value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findArray(item, keys, depth + 1)
      if (hit) return hit
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  for (const v of Object.values(record)) {
    const hit = findArray(v, keys, depth + 1)
    if (hit) return hit
  }
  return undefined
}

/** Last non-empty line — usually the CLI's own error sentence. */
export function lastLine(text: string, max = 400): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const line = lines.at(-1) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Human-readable error out of a CLI's JSON error envelope or its last output line. */
export function cliErrorMessage(stdout: string, stderr: string): string {
  for (const text of [stderr, stdout]) {
    const json = parseJsonOutput(text)
    if (json && typeof json === 'object') {
      const record = json as Record<string, unknown>
      const error = record.error
      if (error && typeof error === 'object') {
        const e = error as Record<string, unknown>
        const message = [e.message, e.msg, e.hint].find((v) => typeof v === 'string' && v.trim())
        if (typeof message === 'string')
          return typeof e.code === 'number' || typeof e.code === 'string' ? `${message}（${String(e.code)}）` : message
      }
      const msg = [record.errmsg, record.message, record.msg].find((v) => typeof v === 'string' && v.trim())
      if (typeof msg === 'string' && (record.errcode ?? 0) !== 0) return `${msg}（${String(record.errcode)}）`
      if (typeof msg === 'string' && record.success === false) return msg
    }
  }
  return lastLine(stderr) || lastLine(stdout) || 'CLI 执行失败'
}
