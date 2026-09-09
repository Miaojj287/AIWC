import { describe, expect, it } from 'vitest'
import { describeLoadFailure, describePreloadError, describeRendererGone } from './preloadDiagnostics'

describe('describePreloadError', () => {
  it('explains an ES-module preload and points at the vite.config.ts output array', () => {
    const msg = describePreloadError('/app/dist-electron/preload.cjs', new SyntaxError('Cannot use import statement outside a module'))
    expect(msg).toContain('/app/dist-electron/preload.cjs')
    expect(msg).toContain('must be CommonJS')
    expect(msg).toContain("format: 'cjs'")
  })

  it('treats a stray top-level export the same way', () => {
    expect(describePreloadError('p.cjs', { message: "Unexpected token 'export'" })).toContain('must be CommonJS')
  })

  it('tells the developer to build when the bundle is missing', () => {
    expect(describePreloadError('p.cjs', { message: "ENOENT: no such file or directory, open 'p.cjs'" })).toContain('vite build')
  })

  it('passes other errors through verbatim', () => {
    const msg = describePreloadError('p.cjs', { message: 'boom' })
    expect(msg).toBe('preload script failed to load: p.cjs: boom')
  })
})

describe('other renderer faults', () => {
  it('formats load failures and crashes on one line', () => {
    expect(describeLoadFailure('file:///x/index.html', -6, 'ERR_FILE_NOT_FOUND')).toBe('renderer failed to load file:///x/index.html: ERR_FILE_NOT_FOUND (-6)')
    expect(describeRendererGone({ reason: 'crashed', exitCode: 11 })).toBe('renderer process gone: crashed (exit code 11)')
  })
})
