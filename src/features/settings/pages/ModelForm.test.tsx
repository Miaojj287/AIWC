// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buttonVariants, cn } from '@/kit'
import { newProvider } from '../aiModel'
import { ModelForm } from './ModelForm'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

const ROW_IDS = { kind: 't.kind', baseUrl: 't.url', apiKey: 't.key', modelId: 't.model', status: 't.status' }
const MODELS = ['gpt-4.1', 'gpt-4o-mini', 'qwen3:8b']

// Radix Popper (the suggestion popover) measures with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Floating UI probes every ancestor with `el.matches(':popover-open')` / `(':modal')`. jsdom's nwsapi
// has no such pseudo-classes and recurses into `matches` until the stack overflows — ~6s per popover
// open. Answer those two probes directly (jsdom has no top layer) and delegate everything else.
const nativeMatches = Element.prototype.matches
const TOP_LAYER = new Set([':popover-open', ':modal'])
beforeEach(() => {
  Element.prototype.matches = function (this: Element, selector: string) {
    return TOP_LAYER.has(selector) ? false : nativeMatches.call(this, selector)
  }
})
afterEach(() => {
  Element.prototype.matches = nativeMatches
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel) => {
    if (channel === 'secret:has') return false
    if (channel === 'ai:listRemoteModels') return MODELS
    return undefined
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderForm = (props: Partial<Parameters<typeof ModelForm>[0]> = {}) =>
  render(<ModelForm provider={newProvider('openai', 'p1')} onSave={async () => {}} purpose="agent" rowIds={ROW_IDS} {...props} />)

const saveButton = () => screen.getByRole('button', { name: '保存' })
const modelInput = () => screen.getByLabelText('模型 ID') as HTMLInputElement

describe('ModelForm 保存 emphasis', () => {
  it('is the screen primary by default', () => {
    renderForm()
    expect(saveButton().className).toBe(cn(buttonVariants({ variant: 'primary' })))
  })

  it('steps down to outline when the page already owns a primary', () => {
    renderForm({ purpose: 'stt', primaryTone: 'outline' })
    expect(saveButton().className).toBe(cn(buttonVariants({ variant: 'outline' })))
    expect(saveButton().className).not.toBe(cn(buttonVariants({ variant: 'primary' })))
  })
})

describe('ModelForm 模型 ID suggestions', () => {
  it('lists fetched models as kit menu items and fills the input on pick', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: '从接口拉取模型列表' }))

    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(MODELS)
    // Geometry comes from the kit menu item (h30, r6, hover 7%), not a hand-rolled button.
    expect(options[0]?.className).toContain('h-[30px]')
    expect(options[0]?.className).toContain('rounded-control')
    expect(options[0]?.className).toContain('hover:bg-hover-7')
    expect(screen.getByText(`接口返回 ${MODELS.length} 个模型 · 匹配 ${MODELS.length} 个`)).toBeTruthy()

    fireEvent.click(options[2] as HTMLElement)
    expect(modelInput().value).toBe('qwen3:8b')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('shows the kit no-results state when nothing matches what was typed', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: '从接口拉取模型列表' }))
    await screen.findAllByRole('option')

    fireEvent.change(modelInput(), { target: { value: 'claude' } })
    expect(await screen.findByText('没有匹配「claude」的模型')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('shows the kit empty state when the endpoint returns no models', async () => {
    invokeMock.mockImplementation(async (channel) => (channel === 'ai:listRemoteModels' ? [] : channel === 'secret:has' ? false : undefined))
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: '从接口拉取模型列表' }))
    expect(await screen.findByText('接口未返回模型')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
