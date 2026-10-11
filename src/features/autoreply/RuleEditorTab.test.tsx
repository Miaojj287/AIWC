// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type AutoReplyRule, type JevPreview, type WxSession } from '@aiwc/protocol'
import { __resetReplyDeskForTests } from '@/features/replydesk/store'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { createMockBridge, type MockBridge } from '@/platform/mockBridge'
import { RuleEditorTab } from './RuleEditorTab'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const session: WxSession = {
  id: 'wxid_alice',
  kind: 'dm',
  title: 'Alice',
  unread: 0,
  pinned: false,
  muted: false,
  lastMessageAt: 1,
}

const preview: JevPreview = {
  decision: {
    model: 'jev-1.13.0',
    choice: 'c1',
    confidence: 0.77,
    probabilities: { c1: 0.8, none: 0.2 },
    options: { c1: '好的收到' },
    needsReply: 0.9,
    threshold: 0.6,
    outcome: 'send',
    latencyMs: 130,
    inputTokens: 240,
  },
  text: '好的收到',
  trigger: { text: '在吗', senderName: 'Alice', at: 1 },
  stateChars: 400,
}

let bridge: MockBridge
let saved: AutoReplyRule | undefined
const previewMock = vi.fn(async () => preview)

function seedConfig(jevConfigured: boolean) {
  const base = defaultConfig()
  useConfigStore.setState({
    config: {
      ...base,
      ai: { ...base.ai, jev: { ...base.ai.jev, apiKeyRef: jevConfigured ? 'ai.jev.apiKey' : undefined } },
    },
    hydrated: true,
    error: undefined,
  })
}

function mount(existing?: AutoReplyRule) {
  bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  bridge.handlers['substrate:getSession'] = () => session
  bridge.handlers['autoreply:getRule'] = () => existing
  bridge.handlers['autoreply:listRecords'] = () => []
  bridge.handlers['autoreply:saveRule'] = (rule) => {
    saved = { ...rule, id: rule.id || 'rule_new', updatedAt: 1 }
    return saved
  }
  bridge.handlers['jev:preview'] = previewMock
  __setBridgeForTests(bridge)
  const update = vi.fn()
  render(
    <TooltipProvider>
      <RuleEditorTab
        tab={{ id: 'autoreply:wxid_alice', kind: 'autoreply', objectId: 'wxid_alice', title: 'Alice' }}
        active
        update={update}
        requestClose={() => {}}
      />
    </TooltipProvider>,
  )
  return { update }
}

const pickJev = async () => fireEvent.click(await screen.findByRole('radio', { name: 'Jev（beta）' }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetConfigStoreForTests()
  __resetReplyDeskForTests()
  saved = undefined
  previewMock.mockClear()
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
  vi.unstubAllGlobals()
})

describe('RuleEditorTab with 回复方式 = Jev（beta）', () => {
  it('offers Jev as the third source; without a key it points at the settings and keeps the dry run off', async () => {
    seedConfig(false)
    mount()
    expect(screen.queryByRole('button', { name: '用最后一条消息试一下' })).toBeNull()
    await pickJev()
    expect(await screen.findByRole('button', { name: '去 AI 接入填写' })).toBeTruthy()
    const run = screen.getByRole('button', { name: '用最后一条消息试一下' })
    expect(run.hasAttribute('disabled') || run.getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('collects candidates, tries them against the last message and saves the rule as source jev', async () => {
    seedConfig(true)
    const { update } = mount()
    await pickJev()
    expect(screen.queryByRole('button', { name: '去 AI 接入填写' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加候选' }))
    fireEvent.change(screen.getByRole('textbox', { name: '候选 1' }), { target: { value: '好的收到' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith({ dirty: true }))

    fireEvent.click(screen.getByRole('button', { name: '用最后一条消息试一下' }))
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    const request = previewMock.mock.calls[0] as unknown as [{ sessionId: string; rule: AutoReplyRule }]
    expect(request[0]).toMatchObject({
      sessionId: 'wxid_alice',
      rule: { source: 'jev', jev: { candidates: ['好的收到'] } },
    })
    const result = await screen.findByTestId('jev-preview-result')
    expect(within(result).getByText('会直接发出')).toBeTruthy()
    expect(within(result).getByText('80%')).toBeTruthy()
    expect(within(result).getByText('不回复')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved).toMatchObject({
      sessionId: 'wxid_alice',
      source: 'jev',
      jev: { candidates: ['好的收到'], allowSilence: true, minConfidence: 0.6 },
    })
  })

  it('switching an existing AI rule to Jev keeps its switch and send mode and replaces it on save', async () => {
    seedConfig(true)
    mount({
      id: 'rule_old',
      sessionId: 'wxid_alice',
      enabled: true,
      source: 'ai',
      prompt: 'p',
      historyCount: 30,
      sendMode: 'auto',
      updatedAt: 1,
    })
    await pickJev()
    fireEvent.click(screen.getByRole('button', { name: '添加候选' }))
    fireEvent.change(screen.getByRole('textbox', { name: '候选 1' }), { target: { value: '收到' } })
    fireEvent.click(await screen.findByRole('button', { name: '保存规则' }))
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved).toMatchObject({ id: 'rule_old', source: 'jev', sendMode: 'auto', jev: { candidates: ['收到'] } })
  })
})
