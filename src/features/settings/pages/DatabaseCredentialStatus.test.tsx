import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TooltipProvider } from '@/kit'
import { DatabaseCredentialStatus, SavedDatabaseCredentials } from './DatabaseCredentialStatus'

afterEach(cleanup)

it('shows incomplete database coverage and the unavailable file rather than a complete connection', () => {
  render(
    <DatabaseCredentialStatus
      credentials={{
        database: true,
        imageXor: false,
        imageAes: false,
        matched: 2,
        total: 3,
        missing: ['message/message_1.db'],
        revision: 1,
      }}
    />,
  )
  expect(screen.getByText('已解锁 2 / 3 个数据库，部分聊天记录暂不可读')).toBeTruthy()
  expect(screen.getByText('message/message_1.db')).toBeTruthy()
  expect(screen.queryByText('连接已保存，可直接进入')).toBeNull()
})

it('keeps private saved bundle material masked without reveal or copy actions', () => {
  render(
    <TooltipProvider>
      <SavedDatabaseCredentials />
    </TooltipProvider>,
  )
  const field = screen.getByRole('textbox', { name: '已保存的微信连接凭据' })
  expect(field.getAttribute('value')).toMatch(/^•+$/)
  expect(screen.queryByRole('button')).toBeNull()
})

it('keeps auxiliary icon coverage visible without claiming that chat history is unavailable', () => {
  render(
    <DatabaseCredentialStatus
      credentials={{
        database: true,
        imageXor: true,
        imageAes: true,
        matched: 24,
        total: 25,
        missing: ['third_app_icon/third_app_icon.db'],
        revision: 1,
      }}
    />,
  )
  screen.getByText('已解锁 24 / 25 个数据库；剩余的第三方应用图标库不影响当前聊天读取。')
  screen.getByText('third_app_icon/third_app_icon.db')
  expect(screen.queryByText(/部分聊天记录暂不可读/)).toBeNull()
})

it('reports an unknown locked file without inferring that it contains chat history', () => {
  render(
    <DatabaseCredentialStatus
      credentials={{
        database: true,
        imageXor: false,
        imageAes: false,
        matched: 2,
        total: 3,
        missing: ['unknown/unknown.db'],
        revision: 1,
      }}
    />,
  )
  screen.getByText('已解锁 2 / 3 个数据库，部分数据库暂不可读')
  screen.getByText('unknown/unknown.db')
  expect(screen.queryByText(/部分聊天记录暂不可读/)).toBeNull()
})
