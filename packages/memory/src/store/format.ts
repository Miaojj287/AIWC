/**
 * On-disk format of the four memory files: entries separated by a line containing only `§`.
 * Canonical serialisation is `entries.join('\n§\n') + '\n'`; round-trip checks are whitespace-tolerant
 * so a hand edit that only adds blank lines is not treated as drift.
 */
import type { MemoryFile } from '@aiwc/protocol'

export const MEMORY_FILES: readonly MemoryFile[] = ['MEMORY', 'USER', 'SOUL', 'AGENTS']

export const DEFAULT_MEMORY_LIMITS: Readonly<Record<MemoryFile, number>> = {
  MEMORY: 4000,
  USER: 2500,
  SOUL: 3000,
  AGENTS: 3000,
}

export const ENTRY_DELIMITER = '\n§\n'

export const MEMORY_FILE_LABELS: Readonly<Record<MemoryFile, string>> = {
  MEMORY: '当下事实与备忘',
  USER: '关于用户',
  SOUL: 'Agent 人格',
  AGENTS: '用户规则',
}

export function isMemoryFile(v: unknown): v is MemoryFile {
  return typeof v === 'string' && (MEMORY_FILES as readonly string[]).includes(v)
}

function normaliseLines(raw: string): string[] {
  return raw.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd())
}

function trimBlankEdges(lines: string[]): string[] {
  let s = 0
  let e = lines.length
  while (s < e && lines[s] === '') s++
  while (e > s && lines[e - 1] === '') e--
  return lines.slice(s, e)
}

/** Raw segments between delimiter lines, each already stripped of trailing spaces and blank edges. */
function segments(raw: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  for (const line of normaliseLines(raw)) {
    if (line.trim() === '§') {
      out.push(trimBlankEdges(cur).join('\n'))
      cur = []
    } else cur.push(line)
  }
  out.push(trimBlankEdges(cur).join('\n'))
  return out
}

/** Split file content into trimmed, non-empty entries. */
export function parseEntries(raw: string): string[] {
  return segments(raw)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Canonical content without trailing newline (used for char budgets). */
export function joinEntries(entries: readonly string[]): string {
  return entries.join(ENTRY_DELIMITER)
}

/** Canonical file content (trailing newline, empty file when no entries). */
export function serializeEntries(entries: readonly string[]): string {
  return entries.length ? joinEntries(entries) + '\n' : ''
}

/**
 * True when rewriting the parsed entries would not alter any segment: no empty segments (doubled,
 * leading or trailing `§`) and no segment whose text differs from its trimmed form. Blank lines around
 * delimiters and trailing spaces are tolerated because a rewrite only drops those.
 */
export function roundTrips(raw: string): boolean {
  if (raw.trim() === '') return true
  return segments(raw).every((s) => s !== '' && s === s.trim())
}

export function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.round((used / limit) * 100)
}

/** Header line shown at the top of each file in the frozen snapshot, e.g. `[MEMORY 63% · 1392/2200 字]`. */
export function renderHeader(file: MemoryFile, used: number, limit: number): string {
  return `[${file} ${usagePercent(used, limit)}% · ${used}/${limit} 字]`
}

export function renderSnapshotBlock(file: MemoryFile, entries: readonly string[], limit: number): string {
  const body = joinEntries(entries)
  return `${renderHeader(file, body.length, limit)}\n${body || '（空）'}`
}
