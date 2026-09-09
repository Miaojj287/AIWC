import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger, formatLine } from './log'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-log-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('logger', () => {
  it('writes formatted lines, honours level and scope', () => {
    const file = join(dir, 'logs', 'main.log')
    const log = createLogger({ file, console: false, level: 'info', clock: () => new Date('2026-09-06T00:00:00Z') })
    log.debug('hidden')
    log.child('ipc').warn('slow', { ms: 12 })
    log.error('boom', new Error('x'))
    const text = readFileSync(file, 'utf8')
    expect(text).not.toContain('hidden')
    expect(text).toContain('2026-09-06T00:00:00.000Z WARN  [ipc] slow {"ms":12}')
    expect(text).toContain('ERROR boom {"name":"Error","message":"x"')
    expect(formatLine(new Date(0), 'info', undefined, 'm')).toBe('1970-01-01T00:00:00.000Z INFO  m\n')
  })

  it('rotates at maxBytes and keeps at most maxFiles files', () => {
    const file = join(dir, 'main.log')
    const log = createLogger({ file, console: false, maxBytes: 200, maxFiles: 3 })
    for (let i = 0; i < 40; i++) log.info(`line ${i} ${'x'.repeat(40)}`)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(existsSync(`${file}.2`)).toBe(true)
    expect(existsSync(`${file}.3`)).toBe(false)
    expect(log.files()).toEqual([file, `${file}.1`, `${file}.2`])
    // newest data is in the active file
    expect(readFileSync(file, 'utf8')).toContain('line 39')
  })
})
