// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type ProviderConfig } from '@aiwc/protocol'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { modelEntryFromId, newProvider, providerFromVendor } from '../aiModel'
import { vendorById } from '../vendors'
import { AiPage } from './AiPage'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Seed the config store the way hydrate() would. */
function seedConfig(providers: ProviderConfig[], sttMode: 'local' | 'online' = 'local') {
  const base = defaultConfig()
  useConfigStore.setState({
    config: { ...base, ai: { ...base.ai, providers, defaultModel: providers[0]?.models[0] ? { providerId: providers[0].id, modelId: providers[0].models[0].modelId } : undefined, stt: { ...base.ai.stt, mode: sttMode } } },
    hydrated: true,
    error: undefined,
  })
}

const glm = (): ProviderConfig => ({ ...providerFromVendor(vendorById('glm')!), models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'].map(id => modelEntryFromId(id)), modelsSyncedAt: Date.now(), apiKeyRef: 'provider:glm:apiKey', lastTest: { ok: true, at: 1, latencyMs: 420 } })

const primaryButtons = () => Array.from(document.querySelectorAll('button')).filter((b) => b.classList.contains('bg-accent'))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetConfigStoreForTests()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel) => (channel === 'secret:has' ? false : undefined))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetConfigStoreForTests()
})

describe('AiPage vendor rail + provider panel', () => {
  it('lists every vendor preset plus 自定义 and lands on the default model\'s vendor', async () => {
    seedConfig([glm()])
    render(<AiPage />)
    const rail = await screen.findByRole('tablist', { name: '模型厂商' })
    const tabs = within(rail).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['DeepSeek', 'Kimi', 'GLM', 'Qwen', 'MiniMax', 'Hunyuan', 'Seed', 'OpenAI', 'Anthropic', 'Gemini', 'Ollama', '自定义'])
    expect(within(rail).getByRole('tab', { name: /GLM/ }).getAttribute('aria-selected')).toBe('true')
    // connected vendor: status dot, 编辑 Key / 断开, enabled toggles, no primary on the page
    expect(within(rail).getByLabelText('已接入')).toBeTruthy()
    expect(screen.getByRole('button', { name: '编辑 Key' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '断开' })).toBeTruthy()
    expect(screen.getByText('已连接 · 延迟 420 ms · 支持工具调用')).toBeTruthy()
    const toggles = screen.getAllByRole('switch', { name: /^启用 / })
    expect(toggles.length).toBe(3)
    for (const t of toggles) expect((t as HTMLButtonElement).disabled).toBe(false)
    expect(primaryButtons()).toHaveLength(0)
  })

  it('shows an honest empty state and a single 接入 primary before connecting', async () => {
    seedConfig([glm()])
    render(<AiPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Kimi' }))
    expect(screen.getByRole('button', { name: '接入' })).toBeTruthy()
    expect(primaryButtons()).toHaveLength(1)
    expect(primaryButtons()[0]?.textContent).toBe('接入')
    expect(screen.queryAllByRole('switch', { name: /^启用 / })).toHaveLength(0)
    expect(screen.getByText('尚未接入 Kimi')).toBeTruthy()
    expect(screen.getByText('Moonshot 开放平台')).toBeTruthy()
  })

  it('opens the 接入 dialog without static model suggestions and a 前往官网获取 link', async () => {
    seedConfig([])
    render(<AiPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'DeepSeek' }))
    fireEvent.click(screen.getByRole('button', { name: '接入' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('接入 DeepSeek')).toBeTruthy()
    expect(within(dialog).getByLabelText('API Key')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /前往官网获取/ }).getAttribute('href')).toBe('https://platform.deepseek.com/api_keys')
    const chips = within(within(dialog).getByRole('group', { name: '可用模型' })).queryAllByRole('button', { pressed: true })
    expect(chips).toHaveLength(0)
    // key missing → 确认 disabled with the reason
    const confirm = within(dialog).getByRole('button', { name: '确认' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(confirm.getAttribute('title')).toBe('请填写 API Key')
  })

  it('lists hand-configured endpoints under 自定义接口', async () => {
    const custom = { ...newProvider('openai-compatible', 'gw'), label: '公司网关', baseUrl: 'https://gw.example/v1', apiKeyRef: 'provider:gw:apiKey' }
    seedConfig([custom])
    render(<AiPage />)
    const rail = await screen.findByRole('tablist', { name: '模型厂商' })
    expect(within(rail).getByRole('tab', { name: /公司网关/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
  })
})

describe('AiPage primary button budget with the transcription form', () => {
  it('keeps at most one primary when 转写模式 is 在线 (the STT form saves with an outline button)', async () => {
    seedConfig([glm()], 'online')
    render(<AiPage />)
    expect(await screen.findAllByRole('button', { name: '保存' })).toHaveLength(1)
    expect(primaryButtons().length).toBeLessThanOrEqual(1)
  })

  it('has no 保存 button when 转写模式 is 本地', async () => {
    seedConfig([glm()], 'local')
    render(<AiPage />)
    await screen.findByRole('tablist', { name: '模型厂商' })
    expect(screen.queryAllByRole('button', { name: '保存' })).toHaveLength(0)
    expect(primaryButtons().length).toBeLessThanOrEqual(1)
  })
})
