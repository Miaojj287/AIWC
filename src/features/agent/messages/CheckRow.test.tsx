import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TurnCheck, TurnId } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage, t } from '@/i18n'
import { CheckRow, checkSummary, type CheckItem } from './CheckRow'

afterEach(() => {
  cleanup()
  __resetLanguageForTests()
})

const turnId = 'trn_1' as TurnId
const pass: TurnCheck = { kind: 'citations', checked: 5, failed: 0, issues: [], action: 'none' }
const fail: TurnCheck = {
  kind: 'citations',
  checked: 5,
  failed: 1,
  issues: [{ code: 'quote_mismatch', link: '[19:28](wx://s/m)', quote: '我就是老陈', excerpt: '只是小陈另有其人' }],
  action: 'rewrite',
}
const item = (id: string, check: TurnCheck): CheckItem => ({ kind: 'check', id, turnId, check })

describe('checkSummary', () => {
  it('says what the checks found and what the turn did about it', () => {
    expect(checkSummary([pass], false, t).text).toBe('已核对 5 处引用 · 全部相符')
    expect(checkSummary([fail], true, t)).toEqual({ text: '已核对 5 处引用 · 1 处不符，正在重写', tone: 'busy' })
    expect(checkSummary([fail, pass], false, t)).toEqual({ text: '已核对 5 处引用 · 1 处不符，已重写', tone: 'ok' })
    expect(checkSummary([fail, { ...fail, action: 'kept' }], false, t).text).toBe(
      '已核对 5 处引用 · 1 处不符，重写后仍有 1 处',
    )
    setLanguage('en-US')
    expect(checkSummary([fail, pass], false, t).text).toBe("Checked 5 citations · 1 didn't match, answer rewritten")
  })
})

describe('<CheckRow>', () => {
  it('draws one row for the turn, opening to what did not match', () => {
    const first = item('c1', fail)
    const last = item('c2', pass)
    const { container } = render(
      <>
        <CheckRow item={first} turnChecks={[first, last]} running={false} />
        <CheckRow item={last} turnChecks={[first, last]} running={false} />
      </>,
    )
    expect(container.querySelectorAll('[data-item="check"]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /已重写/ }))
    expect(screen.getByText('「我就是老陈」不在引用的消息里')).toBeTruthy()
    expect(screen.getByText('原文：只是小陈另有其人')).toBeTruthy()
  })

  it('is a plain line when everything matched', () => {
    const only = item('c1', pass)
    render(<CheckRow item={only} turnChecks={[only]} running={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('已核对 5 处引用 · 全部相符')).toBeTruthy()
  })
})
