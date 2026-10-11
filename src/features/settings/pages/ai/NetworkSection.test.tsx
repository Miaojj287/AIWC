// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, PROXY_PASSWORD_SECRET_REF, type ProxyConfig } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { NetworkSection } from './NetworkSection'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))
vi.mock('@/platform/hooks', () => ({ invoke: invokeMock }))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mount(proxy: Partial<ProxyConfig>) {
  const base = defaultConfig()
  useConfigStore.setState({
    config: { ...base, ai: { ...base.ai, proxy: { ...base.ai.proxy, ...proxy } } },
    hydrated: true,
    error: undefined,
  })
  const set = vi.spyOn(useConfigStore.getState(), 'set').mockResolvedValue(base)
  render(
    <TooltipProvider>
      <NetworkSection />
    </TooltipProvider>,
  )
  return { set }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetConfigStoreForTests()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel) => (channel === 'secret:has' ? false : undefined))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('网络 › 代理', () => {
  it('follows the system by default and switches mode at once', async () => {
    const { set } = mount({})
    expect(screen.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '手动' }))
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({ ai: { proxy: expect.objectContaining({ mode: 'manual' }) } }),
    )
  })

  it('validates the manual address before saving it, normalized', async () => {
    const { set } = mount({ mode: 'manual' })
    const input = screen.getByLabelText('代理地址')
    fireEvent.change(input, { target: { value: 'http://user:pw@proxy:8080' } })
    expect(screen.getByText('用户名和密码请填在「代理认证」里')).toBeTruthy()
    fireEvent.blur(input)
    expect(set).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '127.0.0.1:7890' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({ ai: { proxy: expect.objectContaining({ url: 'http://127.0.0.1:7890' }) } }),
    )
  })

  it('keeps the proxy password in the secret store, not the config', async () => {
    const { set } = mount({ mode: 'manual', url: 'http://proxy:3128' })
    const password = screen.getByLabelText('密码')
    fireEvent.change(password, { target: { value: 's3cret' } })
    fireEvent.blur(password)
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('secret:set', { ref: PROXY_PASSWORD_SECRET_REF, value: 's3cret' }),
    )
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        ai: { proxy: expect.objectContaining({ passwordRef: PROXY_PASSWORD_SECRET_REF }) },
      }),
    )
    expect(JSON.stringify(set.mock.calls)).not.toContain('s3cret')
  })

  it('reports the proxy test result', async () => {
    mount({})
    invokeMock.mockImplementation(async (channel) =>
      channel === 'models:testProxy'
        ? { ok: true, route: 'proxy', proxy: 'http://127.0.0.1:7890', latencyMs: 85 }
        : false,
    )
    fireEvent.click(screen.getByRole('button', { name: '测试代理' }))
    expect(await screen.findByText('经 http://127.0.0.1:7890 连通 · 85 毫秒')).toBeTruthy()
  })
})
