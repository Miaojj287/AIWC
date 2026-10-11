// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionAction } from './SelectionAction'

afterEach(cleanup)

function Host({ onAction }: { onAction: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={ref}>
        <p>可以引用的文字</p>
      </div>
      <p>外面的文字</p>
      <SelectionAction containerRef={ref} label="引用到 Agent" onAction={onAction} />
    </>
  )
}

function select(node: Node, from: number, to: number) {
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
}

describe('<SelectionAction>', () => {
  it('appears over a finished selection inside the container and hands over its text', async () => {
    const onAction = vi.fn()
    render(<Host onAction={onAction} />)
    select(screen.getByText('可以引用的文字').firstChild!, 0, 4)
    act(() => {
      fireEvent.mouseUp(document)
    })
    const button = await screen.findByRole('button', { name: '引用到 Agent' })
    fireEvent.click(button)
    expect(onAction).toHaveBeenCalledWith('可以引用')
    expect(screen.queryByRole('button', { name: '引用到 Agent' })).toBeNull()
  })

  it('stays hidden for a selection outside the container', async () => {
    render(<Host onAction={vi.fn()} />)
    select(screen.getByText('外面的文字').firstChild!, 0, 2)
    act(() => {
      fireEvent.mouseUp(document)
    })
    await new Promise((r) => setTimeout(r, 30))
    await waitFor(() => expect(screen.queryByRole('button', { name: '引用到 Agent' })).toBeNull())
  })
})
