import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetLanguageForTests, getLanguage, setLanguage, t, Trans, useT } from './index'

function Label() {
  const tr = useT()
  return <span data-testid="label">{tr('common.cancel')}</span>
}

describe('renderer i18n binding', () => {
  afterEach(() => __resetLanguageForTests())

  it('defaults to zh-CN so existing copy assertions keep working', () => {
    expect(getLanguage()).toBe('zh-CN')
    expect(t('common.cancel')).toBe('取消')
  })

  it('switches module-level t and re-renders useT consumers', () => {
    render(<Label />)
    expect(screen.getByTestId('label').textContent).toBe('取消')
    act(() => setLanguage('en-US'))
    expect(screen.getByTestId('label').textContent).toBe('Cancel')
    expect(t('common.cancel')).toBe('Cancel')
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('splices element params into the translated sentence', () => {
    const { container } = render(<Trans k="kit.dialog.typeToConfirm" params={{ word: <b>清空</b> }} />)
    expect(container.innerHTML).toBe('输入「<b>清空</b>」以确认')
    act(() => setLanguage('en-US'))
    expect(container.innerHTML).toBe('Type "<b>清空</b>" to confirm')
  })
})
