import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type WechatCredentialStatus } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { OnboardingWizard } from './OnboardingWizard'
import { __resetWizardStoreForTests } from './wizardStore'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
  __resetWizardStoreForTests()
  __resetLanguageForTests()
})

function setup(database: boolean, info?: Promise<{ dataDir: string }>, connectionOk = true) {
  const config = {
    ...defaultConfig(),
    onboarding: { completed: true },
    account: { ...defaultConfig().account, wxid: 'saved', dbRoot: '/saved' },
  }
  const credentials: WechatCredentialStatus = {
    database,
    imageXor: false,
    imageAes: false,
    matched: database ? 2 : 0,
    total: 2,
    missing: [],
    revision: 1,
  }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'app:getInfo') return info ?? { dataDir: '/app' }
    if (channel === 'substrate:listAccounts') return [{ wxid: 'saved', dbRoot: '/saved', verified: database }]
    if (channel === 'substrate:credentialStatus') return credentials
    if (channel === 'substrate:testConnection' || channel === 'substrate:connect') return { ok: connectionOk }
    throw new Error(`unexpected ${channel}`)
  })
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  useConfigStore.setState({ config, hydrated: true })
  const onDone = vi.fn()
  render(
    <TooltipProvider>
      <OnboardingWizard returning onDone={onDone} />
    </TooltipProvider>,
  )
  return { invoke, onDone }
}

it.each([
  ['zh-CN', '进入', '聊天记录可读'],
  ['en-US', 'Enter', 'Chat history is available'],
] as const)('shows cached connection status in %s and opens only after entry', async (language, enter, ready) => {
  setLanguage(language)
  const { invoke, onDone } = setup(true)
  await screen.findByText(ready)
  const button = screen.getByRole('button', { name: enter })
  expect(onDone).not.toHaveBeenCalled()
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
    'app:getInfo',
    'substrate:listAccounts',
    'substrate:credentialStatus',
  ])
  fireEvent.click(button)
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
    'app:getInfo',
    'substrate:listAccounts',
    'substrate:credentialStatus',
    'substrate:testConnection',
    'substrate:connect',
  ])
})

it('shows the connection page immediately and blocks connection until cached status is checked', async () => {
  const info = Promise.withResolvers<{ dataDir: string }>()
  const { invoke, onDone } = setup(true, info.promise)
  const button = screen.getByRole('button', { name: '连接微信' })
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: '开始' })).toBeNull()
  fireEvent.click(button)
  await waitFor(() => expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['app:getInfo']))
  await act(async () => info.resolve({ dataDir: '/app' }))
  await screen.findByText('聊天记录可读')
  expect(screen.getByRole('button', { name: '进入' }).hasAttribute('disabled')).toBe(false)
  expect(onDone).not.toHaveBeenCalled()
})

it('offers an explicit connection when saved credentials are unavailable', async () => {
  const { invoke, onDone } = setup(false)
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('substrate:credentialStatus', { wxid: 'saved', dbRoot: '/saved' }),
  )
  expect(screen.getByRole('button', { name: '连接微信' }).hasAttribute('disabled')).toBe(false)
  expect(screen.queryByRole('button', { name: '进入' })).toBeNull()
  expect(onDone).not.toHaveBeenCalled()
  expect(invoke.mock.calls).toHaveLength(3)
})

it('keeps a failed cached entry visible and does not automatically acquire credentials', async () => {
  const { invoke, onDone } = setup(true, undefined, false)
  fireEvent.click(await screen.findByRole('button', { name: '进入' }))
  await screen.findByRole('dialog')
  expect(onDone).not.toHaveBeenCalled()
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
    'app:getInfo',
    'substrate:listAccounts',
    'substrate:credentialStatus',
    'substrate:testConnection',
  ])
})
