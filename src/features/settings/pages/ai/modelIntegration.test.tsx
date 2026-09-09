import type { ProviderConfig } from '@aiwc/protocol'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectProviderDialog } from './ConnectProviderDialog'
import { ModelSettingsPopover } from './ModelSettingsPopover'
import { modelEntryFromId } from '../../aiModel'
import { vendorById } from '../../vendors'
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@/platform/hooks', () => ({ invoke: invokeMock, useBridgeEvent: () => {}, useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }) }))
const nativeMatches = Element.prototype.matches
beforeEach(() => {
  Element.prototype.matches = function (selector: string) { return [':popover-open', ':modal'].includes(selector) ? false : nativeMatches.call(this, selector) }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel: string) => channel === 'secret:has' ? false : channel === 'ai:discoverModels' ? [{ ...modelEntryFromId('future-chat-model'), source: 'remote', available: true }] : undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Element.prototype.matches = nativeMatches })

describe('model integration UI', () => {
  it('connects with only credentials, discovers models automatically, and never seeds stale presets', async () => {
    const onSave = vi.fn(async (_provider: ProviderConfig) => {})
    render(<ConnectProviderDialog open onOpenChange={() => {}} mode="connect" vendor={vendorById('openai')} onSave={onSave} />)
    expect(screen.queryByText('gpt-4.1')).toBeNull()
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-only-key' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(invokeMock.mock.calls.some(([channel]) => channel === 'ai:discoverModels')).toBe(true)
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ models: [{ modelId: 'future-chat-model', enabled: true }], modelsSyncedAt: expect.any(Number) })
  })
  it('saves credentials on discovery failure without inventing available models', async () => {
    invokeMock.mockImplementation(async (channel: string) => { if (channel === 'ai:discoverModels') throw new Error('HTTP 401'); return false })
    const onSave = vi.fn(async (_provider: ProviderConfig) => {})
    render(<ConnectProviderDialog open onOpenChange={() => {}} mode="connect" vendor={vendorById('anthropic')} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-only-key' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ models: [] })
  })
  it.each([
    ['openai', 'gpt-4.1', false, false, true],
    ['openai', 'gpt-5.4', true, false, false],
    ['google', 'gemini-2.5-pro', false, true, true],
    ['google', 'gemini-3-pro-preview', true, false, false],
  ] as const)('shows supported controls for %s / %s', async (kind, modelId, effort, budget, temperature) => {
    render(<ModelSettingsPopover provider={{ kind }} model={modelEntryFromId(modelId)} onPatch={() => {}} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: `设置 ${modelId}` }))
    await screen.findByText('最大输出')
    expect(Boolean(screen.queryByLabelText('推理强度'))).toBe(effort)
    expect(Boolean(screen.queryByLabelText('思考预算'))).toBe(budget)
    expect(Boolean(screen.queryByLabelText('温度'))).toBe(temperature)
    expect(screen.queryByLabelText('快速模式')).toBeNull()
  })
  it('allows entering a multi-digit thinking budget before committing on blur', async () => {
    const onPatch = vi.fn()
    render(<ModelSettingsPopover provider={{ kind: 'google' }} model={modelEntryFromId('gemini-2.5-pro')} onPatch={onPatch} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '设置 gemini-2.5-pro' }))
    const budget = await screen.findByLabelText('思考预算')
    fireEvent.change(budget, { target: { value: '4' } })
    fireEvent.change(budget, { target: { value: '4096' } })
    expect(onPatch).not.toHaveBeenCalled()
    fireEvent.blur(budget)
    expect(onPatch).toHaveBeenCalledWith({ thinkingBudget: 4096 })
  })
})
