import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type KeyAcquireStep } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { WechatConnectionSection } from './WechatConnectionSection'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetLanguageForTests()
})

function setup(database: boolean, bundle = false) {
  const account = { ...defaultConfig().account, wxid: 'account_a', dbRoot: '/data' }
  if (bundle) account.dbCredentialsRef = 'account:databaseCredentials'
  let finish: (steps: KeyAcquireStep[]) => void = () => {}
  const acquisition = new Promise<KeyAcquireStep[]>((resolve) => (finish = resolve))
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'substrate:credentialStatus')
      return { database, imageXor: true, imageAes: true, matched: database ? 2 : 0, total: 2, missing: [], revision: 1 }
    if (channel === 'secret:has') return true
    if (channel === 'substrate:acquireKeys') return acquisition
    if (channel === 'substrate:cancelAcquireKeys') return undefined
    throw new Error(channel)
  })
  __setBridgeForTests({
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: invoke as AiwcBridge['invoke'],
  })
  const onSaved = vi.fn()
  const onConnect = vi.fn(async () => {})
  const view = render(
    <TooltipProvider>
      <WechatConnectionSection account={account} version={0} onSaved={onSaved} onConnect={onConnect} />
    </TooltipProvider>,
  )
  return { ...view, invoke, finish, onSaved, onConnect }
}

it('opens a saved connection without scanning the process or showing legacy key fields', async () => {
  const { invoke, onConnect } = setup(true)
  await screen.findByText('聊天记录可读')
  expect(screen.queryByLabelText('解密密钥')).toBeNull()
  expect(screen.queryByLabelText('XOR 密钥')).toBeNull()
  expect(screen.queryByLabelText('AES 密钥')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
  expect(
    invoke.mock.calls.some(([channel]) => channel === 'substrate:acquireKeys' || channel === 'secret:reveal'),
  ).toBe(false)
})

it('continues to open the database after an explicit first acquisition', async () => {
  const { invoke, finish, onSaved, onConnect } = setup(false)
  await screen.findByText('保持微信已登录，点击「连接微信」即可读取聊天记录。')
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('substrate:acquireKeys', {
      wxid: 'account_a',
      dbRoot: '/data',
      strategy: 'auto',
      scope: 'database',
    }),
  )
  await act(async () =>
    finish([
      { id: 'db_key', label: '', status: 'done' },
      { id: 'verify', label: '', status: 'done' },
    ]),
  )
  expect(onSaved).toHaveBeenCalledOnce()
  expect(onConnect).toHaveBeenCalledOnce()
})

it('opens and focuses manual recovery only after a failed connection requests it', async () => {
  const { finish, onConnect } = setup(false)
  await screen.findByText('保持微信已登录，点击「连接微信」即可读取聊天记录。')
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await act(async () =>
    finish([
      { id: 'db_key', label: '', status: 'failed', failure: 'not_found' },
      { id: 'verify', label: '', status: 'failed', failure: 'skipped' },
    ]),
  )
  fireEvent.click(await screen.findByRole('button', { name: '手动输入' }))
  expect(document.activeElement).toBe(screen.getByLabelText('解密密钥'))
  expect(onConnect).not.toHaveBeenCalled()
})

it('cancels the old acquisition when its account connection section is removed', async () => {
  const { unmount, invoke, finish, onConnect } = setup(false)
  await screen.findByText('保持微信已登录，点击「连接微信」即可读取聊天记录。')
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === 'substrate:acquireKeys')).toBe(true))
  unmount()
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('substrate:cancelAcquireKeys', undefined))
  await act(async () =>
    finish([
      { id: 'db_key', label: '', status: 'done' },
      { id: 'verify', label: '', status: 'done' },
    ]),
  )
  expect(onConnect).not.toHaveBeenCalled()
})

it('keeps saved per-database credentials masked in advanced recovery', async () => {
  const { invoke } = setup(true, true)
  await screen.findByText('聊天记录可读')
  fireEvent.click(screen.getByRole('button', { name: '高级选项 · 手动输入' }))
  expect(screen.getByRole('textbox', { name: '已保存的微信连接凭据' }).getAttribute('value')).toMatch(/^•+$/)
  expect(screen.queryByLabelText('解密密钥')).toBeNull()
  expect(invoke.mock.calls.some(([channel]) => channel === 'secret:reveal')).toBe(false)
})

it('renders the connection and advanced recovery in English', async () => {
  setLanguage('en-US')
  setup(true)
  await screen.findByText('Chat history is available')
  expect(screen.getByRole('button', { name: 'Connect WeChat' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Advanced · Manual input' })).toBeTruthy()
  expect(screen.getByText('Images available')).toBeTruthy()
})
