import { appendFile, atomicWriteFile, readTextIfExists } from './fsx'

export function readJsonl<T>(path: string): T[] {
  const raw = readTextIfExists(path)
  if (!raw) return []
  const out: T[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as T)
    } catch {
      /* skip corrupt line */
    }
  }
  return out
}

export function writeJsonl(path: string, rows: readonly unknown[]): void {
  atomicWriteFile(path, rows.length ? rows.map((r) => JSON.stringify(r)).join('\n') + '\n' : '')
}

export function appendJsonl(path: string, row: unknown): void {
  appendFile(path, JSON.stringify(row) + '\n')
}
