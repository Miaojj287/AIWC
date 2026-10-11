import { describe, expect, it } from 'vitest'
import { confirmationDetail, fitsConfirmation, MAX_CONFIRM_DETAIL_CHARS, MAX_CONFIRM_DETAIL_LINES } from './confirmText'

describe('confirmation detail', () => {
  it('collapses whitespace runs and blank lines so nothing is pushed out of view', () => {
    expect(confirmationDetail('a\t\t   b\r\n\r\n\n  c  ')).toBe('a b\nc')
    expect(confirmationDetail(`run${'\n'.repeat(500)}payload`)).toBe('run\npayload')
    expect(confirmationDetail('x y 　z')).toBe('x\ny z')
  })

  it('spells out invisible and direction-changing characters', () => {
    expect(confirmationDetail('ls​‮\u0007')).toBe('ls<U+200B><U+202E><U+0007>')
    expect(confirmationDetail('a\u{E0041}')).toBe('a<U+E0041>')
    expect(confirmationDetail('npx 中文 ✓')).toBe('npx 中文 ✓')
  })

  it('fits only what the dialog shows whole', () => {
    expect(fitsConfirmation('x'.repeat(MAX_CONFIRM_DETAIL_CHARS))).toBe(true)
    expect(fitsConfirmation('x'.repeat(MAX_CONFIRM_DETAIL_CHARS + 1))).toBe(false)
    expect(fitsConfirmation(Array.from({ length: MAX_CONFIRM_DETAIL_LINES }, () => 'l').join('\n'))).toBe(true)
    expect(fitsConfirmation(Array.from({ length: MAX_CONFIRM_DETAIL_LINES + 1 }, () => 'l').join('\n'))).toBe(false)
  })
})
