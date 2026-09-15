// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingRow } from './SettingRow'

afterEach(cleanup)

describe('SettingRow', () => {
  it('keeps the description to one line and moves the long explanation behind a ? glyph', () => {
    render(
      <SettingRow title="缓存目录" description="留空使用默认目录" help="存放解密后的数据库副本、图片与索引。">
        <button type="button">选择</button>
      </SettingRow>,
    )
    const help = screen.getByRole('button', { name: '缓存目录说明' })
    // The glyph sits in the title line, right after the title.
    expect(help.closest('div')?.textContent).toContain('缓存目录')
    expect(screen.queryByText('存放解密后的数据库副本、图片与索引。')).toBeNull()
    expect(screen.getByText('留空使用默认目录')).toBeTruthy()
  })

  it('renders no ? glyph without help', () => {
    render(<SettingRow title="开机自启" />)
    expect(screen.queryByRole('button', { name: /说明$/ })).toBeNull()
  })

  it('stacks the control under the text in a narrow row instead of squeezing the title', () => {
    render(
      <SettingRow title="关闭窗口时" data-testid="row">
        <button type="button">每次询问</button>
      </SettingRow>,
    )
    const row = screen.getByTestId('row')
    expect(row.className).toContain('@container')
    const layout = screen.getByRole('button', { name: '每次询问' }).parentElement?.parentElement as HTMLElement
    expect(layout.className).toContain('flex-col')
    expect(layout.className).toContain('@min-[380px]:flex-row')
    // The title can only ellipsize, never wrap one character per line.
    expect(screen.getByText('关闭窗口时').className).toContain('truncate')
  })
})
