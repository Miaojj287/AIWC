import { describe, expect, it } from 'vitest'
import { QUOTE_MAX_CHARS, quoteBlock } from './quoteText'

describe('quoteBlock', () => {
  it('turns a selection into a Markdown blockquote, blank lines kept', () => {
    expect(quoteBlock('  第一行\r\n\r\n第二行  ')).toBe('> 第一行\n>\n> 第二行')
  })

  it('ignores a blank selection and cuts a very long one', () => {
    expect(quoteBlock(' \n ')).toBeUndefined()
    const long = quoteBlock('字'.repeat(QUOTE_MAX_CHARS + 10))!
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBe(QUOTE_MAX_CHARS + 3)
  })
})
