import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * `text-overflow: ellipsis` only renders on the box whose own inline content overflows. Put `truncate` on a
 * `flex` / `inline-flex` element and its text becomes an anonymous flex item: the row is clipped mid-glyph and no
 * `…` ever appears (the half-character bug in the session list and the AI 接入 status line). The ellipsis must
 * sit on the text's own span, with `min-w-0` on every flex item between it and the constrained ancestor.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
  })
}

/** Comments may describe the anti-pattern; only code counts. */
const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('single-line truncation', () => {
  it('never puts `truncate` on a flex container in the same class string', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(srcRoot)) {
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const match of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
        const literal = match[1] ?? match[2] ?? match[3] ?? ''
        const tokens = new Set(literal.split(/\s+/))
        if (tokens.has('truncate') && (tokens.has('flex') || tokens.has('inline-flex'))) {
          offenders.push(`${relative(srcRoot, file)}: ${literal.slice(0, 90)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
