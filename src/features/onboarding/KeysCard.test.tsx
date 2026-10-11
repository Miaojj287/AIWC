import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type KeyAcquireStep } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { KeysCard } from './KeysCard'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
  __resetWizardStoreForTests()
})

it('reveals all three automatically acquired keys before config refs reach the renderer, and hides them again', async () => {
  useConfigStore.setState({ config: defaultConfig(), hydrated: true })
  useWizardStore.setState({
    keys: {
      db_key: { status: 'acquired', source: 'cached' },
      image_xor: { status: 'acquired', source: 'cached' },
      image_aes: { status: 'acquired', source: 'cached' },
    },
  })
  const secrets: Record<string, string> = {
    'account:dbKey': 'a'.repeat(64),
    'account:imageXorKey': '53',
    'account:imageAesKey': 'b'.repeat(32),
  }
  const invoke = vi.fn(async (_channel: string, req: { ref: string }) => secrets[req.ref])
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const { container } = render(
    <TooltipProvider>
      <KeysCard />
    </TooltipProvider>,
  )
  for (const button of screen.getAllByRole('button', { name: '显示' })) fireEvent.click(button)
  await waitFor(() =>
    expect(Array.from(container.querySelectorAll('input')).map((i) => i.value)).toEqual(Object.values(secrets)),
  )
  for (const button of screen.getAllByRole('button', { name: '隐藏' })) fireEvent.click(button)
  expect(Array.from(container.querySelectorAll('input')).every((i) => /^•+$/.test(i.value))).toBe(true)
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
  useWizardStore.setState({ wxid: 'wxid_a', dbRoot: '/root' })
  render(
    <TooltipProvider>
      <KeysCard />
    </TooltipProvider>,
  )
}

it('names the current stage, with what to do while it waits for a login', async () => {
  const bridge = acquireBridge()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: '自动获取' }))
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
  fireEvent.click(screen.getByRole('button', { name: '自动获取' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:acquireKeys', expect.anything()))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:cancelAcquireKeys', undefined))
  expect(useWizardStore.getState().acquireSteps.every((s) => s.status === 'failed')).toBe(true)
})

it('keeps a failed run on screen with its reason and a retry', async () => {
  const bridge = acquireBridge()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: '自动获取' }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('substrate:acquireKeys', expect.anything()))
  act(() =>
    bridge.finish([
      { id: 'db_key', label: '', status: 'failed', failure: 'login_timeout' },
      { id: 'image_xor', label: '', status: 'done' },
      { id: 'image_aes', label: '', status: 'done' },
      { id: 'verify', label: '', status: 'failed', failure: 'skipped' },
    ]),
  )
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('未能获取数据库密钥'))
  screen.getByText(/没有等到重新登录/)
  expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(1)
})
