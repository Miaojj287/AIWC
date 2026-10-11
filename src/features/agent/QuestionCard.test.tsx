// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CallId, TurnId } from '@aiwc/protocol'
import { QuestionCard } from './QuestionCard'
import type { QuestionRequest } from './turnSignals'

afterEach(cleanup)

/** Keys go to whatever has focus (the card focuses its option list on mount). */
const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key })

const request: QuestionRequest = {
  questionId: 'qst_1',
  callId: 'cal_1' as CallId,
  turnId: 'trn_1' as TurnId,
  question: '周报发给谁？',
  options: [{ label: '张三', description: '组长' }, { label: '李四' }],
  allowOther: true,
}

describe('<QuestionCard>', () => {
  it('lists the options and 其他 with number keys; a digit answers at once', () => {
    const onAnswer = vi.fn()
    render(<QuestionCard request={request} onAnswer={onAnswer} />)
    expect(screen.getByText('周报发给谁？')).toBeTruthy()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '1.张三组长',
      '2.李四',
      '3.其他自己输入回答',
    ])
    press('2')
    expect(onAnswer).toHaveBeenCalledWith('qst_1', { kind: 'option', index: 1, label: '李四' })
  })

  it('3 opens the text field; Enter there sends the free-text answer', () => {
    const onAnswer = vi.fn()
    render(<QuestionCard request={request} onAnswer={onAnswer} />)
    press('3')
    const field = screen.getByRole('textbox', { name: '其他' })
    // digits typed into the field are text, not answers
    fireEvent.keyDown(field, { key: '1' })
    expect(onAnswer).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '王五' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onAnswer).toHaveBeenCalledWith('qst_1', { kind: 'other', text: '王五' })
  })

  it('Esc and 不回答 answer dismissed; ↑↓ + 确认 picks the selection', () => {
    const onAnswer = vi.fn()
    render(<QuestionCard request={{ ...request, allowOther: false }} onAnswer={onAnswer} />)
    press('ArrowDown')
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onAnswer).toHaveBeenLastCalledWith('qst_1', { kind: 'option', index: 1, label: '李四' })
    press('Escape')
    expect(onAnswer).toHaveBeenLastCalledWith('qst_1', { kind: 'dismissed' })
    fireEvent.click(screen.getByRole('button', { name: '不回答' }))
    expect(onAnswer).toHaveBeenCalledTimes(3)
  })
})
