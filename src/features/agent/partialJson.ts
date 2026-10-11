/**
 * Best-effort reading of a tool call's arguments while the model is still writing them (`tool.input` deltas): the
 * JSON text so far is closed where it stops — an open string ends, a dangling key or comma is dropped, open
 * arrays / objects are closed — and parsed. Display only: the finished call replaces the result.
 */
import type { JsonValue } from '@aiwc/protocol'

/** The value written so far, or undefined when nothing usable has arrived yet. */
export function parsePartialJson(text: string): JsonValue | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as JsonValue
  } catch {
    // still being written: repair below
  }
  const repaired = closeJson(trimmed)
  if (repaired === undefined) return undefined
  try {
    return JSON.parse(repaired) as JsonValue
  } catch {
    return undefined
  }
}

/** Closes an unfinished JSON text; undefined when it is not JSON at all. */
function closeJson(text: string): string | undefined {
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return undefined
    }
  }
  if (stack.length === 0 && !inString) return undefined
  let out = text
  if (inString) {
    // a half-written escape (`\` or `\u12`) cannot be closed: cut it
    out = out.replace(/\\(u[0-9a-fA-F]{0,3})?$/, '')
    out += '"'
  }
  out = dropDangling(out, stack[stack.length - 1])
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']'
  return out
}

/**
 * What cannot stand before a closing bracket: a trailing comma, a key without its value (`"q"` or `"q":`), or a
 * half-written literal (`tr`, `-`, `1.`).
 */
function dropDangling(text: string, open: '{' | '[' | undefined): string {
  let out = text.trimEnd()
  for (let guard = 0; guard < 4; guard++) {
    const before = out
    out = out.replace(/,\s*$/, '')
    if (open === '{') {
      // `"key":` or a lone `"key"` as the last member of an object
      out = out.replace(/([{,])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, '$1')
    }
    out = out.replace(/([{,[:])\s*(?:-|\d+\.|-?\d*\.?\d*[eE][+-]?|t|tr|tru|f|fa|fal|fals|n|nu|nul)\s*$/, '$1')
    out = out.replace(/:\s*$/, '')
    out = out.replace(/,\s*$/, '').trimEnd()
    if (out === before) break
  }
  return out
}
