import { describe, expect, it } from 'vitest'
import { createHostLogger, describeLogMeta, type HostLogLine } from './hostLog'

describe('describeLogMeta', () => {
  it('keeps strings, names errors and serialises objects', () => {
    expect(describeLogMeta(undefined)).toBeUndefined()
    expect(describeLogMeta('plain')).toBe('plain')
    expect(describeLogMeta(new RangeError('bad page'))).toBe('RangeError: bad page')
    expect(describeLogMeta({ page: 7, path: '/tmp/a.db' })).toBe('{"page":7,"path":"/tmp/a.db"}')
  })

  it('bounds long meta and survives values JSON cannot take', () => {
    const long = describeLogMeta('x'.repeat(900))
    expect(long).toHaveLength(501)
    expect(long?.endsWith('…')).toBe(true)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(describeLogMeta(circular)).toBe('[object Object]')
    expect(describeLogMeta(undefined)).toBeUndefined()
  })
})

describe('createHostLogger', () => {
  it('posts one line per call and omits meta when there is none', () => {
    const lines: HostLogLine[] = []
    const logger = createHostLogger((line) => lines.push(line))

    logger('warn', 'native WCDB unusable')
    logger('debug', 'page decrypt failed', { page: 3 })

    expect(lines).toEqual([
      { type: 'log', level: 'warn', message: 'native WCDB unusable' },
      { type: 'log', level: 'debug', message: 'page decrypt failed', meta: '{"page":3}' },
    ])
    expect('meta' in (lines[0] ?? {})).toBe(false)
  })
})
