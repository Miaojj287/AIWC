// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { findScopeProps, focusedFindScope, quoteScopeProps, selectedQuote } from './focusScope'

const attrs = (props: Record<string, string>) =>
  Object.entries(props)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

function select(node: Node, from: number, to: number) {
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  const sel = document.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

describe('focus scopes', () => {
  it('reports the find scope holding keyboard focus', () => {
    document.body.innerHTML = `<div ${attrs(findScopeProps('agent'))}><textarea></textarea></div><input />`
    document.querySelector('textarea')!.focus()
    expect(focusedFindScope()).toBe('agent')
    document.querySelector('input')!.focus()
    expect(focusedFindScope()).toBeUndefined()
  })

  it('quotes a selection inside one quote scope, with that scope as the source', () => {
    document.body.innerHTML = `<div ${attrs(quoteScopeProps({ kind: 'session', id: 's1', label: '项目群' }))}><p>明天下午开会</p></div><p>外面</p>`
    select(document.querySelector('div p')!.firstChild!, 0, 4)
    expect(selectedQuote()).toEqual({ text: '明天下午', source: { kind: 'session', id: 's1', label: '项目群' } })
    select(document.body.lastChild!.firstChild!, 0, 2)
    expect(selectedQuote()).toBeUndefined()
  })

  it('a scope without a source quotes plain text', () => {
    document.body.innerHTML = `<div ${attrs(quoteScopeProps())}><p>答复正文</p></div>`
    select(document.querySelector('p')!.firstChild!, 0, 2)
    expect(selectedQuote()).toEqual({ text: '答复', source: undefined })
  })
})
