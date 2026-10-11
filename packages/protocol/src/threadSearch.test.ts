import { describe, expect, it } from 'vitest'
import { splitSearchSnippet, THREAD_SEARCH_MARKS } from './threadSearch'

const [o, c] = THREAD_SEARCH_MARKS

describe('splitSearchSnippet', () => {
  it('splits a snippet into plain and matched runs', () => {
    expect(splitSearchSnippet(`…项目群${o}报价${c}讨论，${o}报价${c}截止…`)).toEqual([
      { text: '…项目群', match: false },
      { text: '报价', match: true },
      { text: '讨论，', match: false },
      { text: '报价', match: true },
      { text: '截止…', match: false },
    ])
  })

  it('treats a snippet without marks, or with a broken mark, as plain text', () => {
    expect(splitSearchSnippet('普通文本')).toEqual([{ text: '普通文本', match: false }])
    expect(splitSearchSnippet(`前${o}未闭合`)).toEqual([{ text: '前未闭合', match: false }])
    expect(splitSearchSnippet('')).toEqual([])
  })
})
