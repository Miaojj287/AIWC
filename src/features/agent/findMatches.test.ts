// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { FIND_SKIP_ATTR, findRanges, stepMatch } from './findMatches'

describe('conversation find', () => {
  it('finds case-insensitive matches across text nodes, skipping marked regions', () => {
    const root = document.createElement('div')
    root.innerHTML = `<p>Hello <b>hello</b> HELLO</p><div ${FIND_SKIP_ATTR}>hello</div><p>你好 hello 你好</p>`
    const ranges = findRanges(root, ' Hello ')
    expect(ranges.map((r) => r.toString())).toEqual(['Hello', 'hello', 'HELLO', 'hello'])
    expect(findRanges(root, '你好')).toHaveLength(2)
    expect(findRanges(root, '   ')).toEqual([])
  })

  it('steps around the ring of matches', () => {
    expect(stepMatch(-1, 3, 1)).toBe(0)
    expect(stepMatch(-1, 3, -1)).toBe(2)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(0, 0, 1)).toBe(-1)
  })
})
