import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type KeyAcquireStep } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { KeysCard } from './KeysCard'
import { ConnectStep } from './ConnectStep'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
  __resetWizardStoreForTests()
})

it('keeps saved credentials masked in advanced controls and never reveals them', () => {
  useConfigStore.setState({ config: defaultConfig(), hydrated: true })
  useWizardStore.setState({
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'acquired', source: 'cached' },
      image_aes: { status: 'acquired', source: 'cached' },
    },
  })
  const invoke = vi.fn(async () => undefined)
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const { container } = render(
    <TooltipProvider>
      <KeysCard />
    </TooltipProvider>,
  )
  expect(container.querySelectorAll('input')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '高级选项 · 手动输入' }))
  expect(Array.from(container.querySelectorAll('input')).every((input) => /^•+$/.test(input.value))).toBe(true)
  expect(screen.queryByRole('button', { name: '显示' })).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})

it('deletes a saved key only after the danger confirmation, and cancelling keeps it', async () => {
  useConfigStore.setState({ config: defaultConfig(), hydrated: true })
  useWizardStore.setState({
    hydrated: true,
    wxid: 'wxid_a',
    dbRoot: '/root',
    credentials: {
      database: true,
      imageXor: false,
      imageAes: false,
      matched: 24,
      total: 25,
      missing: ['third_app_icon/third_app_icon.db'],
      revision: 1,
    },
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'missing' },
      image_aes: { status: 'missing' },
    },
  })
  const invoke = vi.fn(async () => undefined)
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  render(
    <TooltipProvider>
      <KeysCard />
    </TooltipProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '高级选项 · 手动输入' }))
  fireEvent.click(screen.getByRole('button', { name: '清除' }))
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  expect(invoke).not.toHaveBeenCalledWith('substrate:clearKey', expect.anything())
  expect(useWizardStore.getState().keys.db_key.status).toBe('acquired')

  fireEvent.click(screen.getByRole('button', { name: '清除' }))
  const dialog = await screen.findByRole('dialog')
  screen.getByText('将从本机删除解密密钥，之后需要重新获取或手动输入。')
  fireEvent.click(within(dialog).getByRole('button', { name: '清除' }))
  await waitFor(() => expect(useWizardStore.getState().keys.db_key.status).toBe('missing'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText('third_app_icon/third_app_icon.db')).toBeNull()
  expect(screen.queryByText('尚未配置微信账号')).toBeNull()
  expect(screen.queryByRole('button', { name: '清除' })).toBeNull()
  expect(invoke).toHaveBeenCalledWith('substrate:clearKey', {
    kind: 'db_key',
    target: { wxid: 'wxid_a', dbRoot: '/root' },
  })
})

it('shows an authenticated chat connection when only the auxiliary icon store is missing', () => {
  useWizardStore.setState({
    hydrated: true,
    credentials: {
      database: true,
      imageXor: true,
      imageAes: true,
      matched: 24,
      total: 25,
      missing: ['third_app_icon/third_app_icon.db'],
      revision: 1,
    },
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'acquired', source: 'cached' },
      image_aes: { status: 'acquired', source: 'cached' },
    },
  })
  render(
    <TooltipProvider>
      <KeysCard returning />
    </TooltipProvider>,
  )
  screen.getByText('聊天记录可读')
  screen.getByText('已解锁 24 / 25 个数据库；剩余的第三方应用图标库不影响当前聊天读取。')
  screen.getByText('third_app_icon/third_app_icon.db')
  screen.getByText('已恢复保存的连接，点击「进入」即可读取，无需重新获取密钥。')
})

/** A bridge whose acquireKeys stays pending until `finish` is called; pushes go through `push`. */
function acquireBridge() {
  let listener: ((step: KeyAcquireStep) => void) | undefined
  let finish: (steps: KeyAcquireStep[]) => void = () => {}
  const invoke = vi.fn((channel: string) => {
    if (channel === 'substrate:acquireKeys') return new Promise<KeyAcquireStep[]>((resolve) => (finish = resolve))
    return Promise.resolve(undefined)
  })
  const on = (_channel: string, fn: (step: KeyAcquireStep) => void) => {
    listener = fn
    return () => (listener = undefined)
  }
  __setBridgeForTests({ invoke, on } as unknown as AiwcBridge)
  return {
    invoke,
    push: (step: KeyAcquireStep) => listener?.(step),
    finish: (steps: KeyAcquireStep[]) => finish(steps),
  }
}

function renderCard() {
  useConfigStore.setState({ config: defaultConfig(), hydrated: true })
  useWizardStore.setState({ hydrated: true, wxid: 'wxid_a', dbRoot: '/root' })
  render(
    <TooltipProvider>
      <ConnectStep onBack={() => {}} onNext={() => void useWizardStore.getState().connect()} stepsBar={null} />
    </TooltipProvider>,
  )
}

it('names the current stage, with what to do while it waits for a login', async () => {
  const bridge = acquireBridge()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:acquireKeys', expect.anything()))
  act(() =>
    bridge.push({
      id: 'db_key',
      label: '',
      status: 'doing',
      phase: 'waiting_login',
      waitUntil: Date.now() + 90_000,
    }),
  )
  expect(screen.getByRole('status').textContent).toBe('请重新登录微信')
  screen.getByText(/在微信中退出登录再登录/)
})

it('cancels the main-process run, not only the panel', async () => {
  const bridge = acquireBridge()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:acquireKeys', expect.anything()))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:cancelAcquireKeys', undefined))
  expect(useWizardStore.getState().acquireSteps.map((step) => step.id)).toEqual(['db_key', 'verify'])
  expect(useWizardStore.getState().acquireSteps.every((s) => s.status === 'failed')).toBe(true)
})

it('keeps a failed run on screen with its reason and a retry', async () => {
  const bridge = acquireBridge()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:acquireKeys', expect.anything()))
  act(() =>
    bridge.finish([
      { id: 'db_key', label: '', status: 'failed', failure: 'login_timeout' },
      { id: 'image_xor', label: '', status: 'done' },
      { id: 'image_aes', label: '', status: 'done' },
      { id: 'verify', label: '', status: 'failed', failure: 'skipped' },
    ]),
  )
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('微信连接未完成'))
  screen.getByText(/没有等到重新登录/)
  expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(1)
})
