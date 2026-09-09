// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryItem, ItemId, StepId, TurnId } from '@aiwc/protocol'
import { PersonaChat } from './PersonaChat'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))

vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

const REPLY = '好啊，明天见'
const HISTORY: HistoryItem[] = [{ type: 'assistant_message', id: 'itm_a1' as ItemId, turnId: 'trn_1' as TurnId, stepId: 'stp_1' as StepId, createdAt: 1_700_000_000_000, text: REPLY }]

// jsdom lacks both; Radix Popper (context menu) needs the former, the transcript auto-scroll the latter.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Floating UI probes every ancestor with `el.matches(':popover-open')` / `(':modal')`. jsdom's nwsapi
// has no such pseudo-classes and recurses into `matches` until the stack overflows — ~6s per menu
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
  Element.prototype.scrollIntoView = vi.fn()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel) => {
    if (channel === 'agent:getThread') return { summary: {}, items: HISTORY }
    return undefined
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const clearCalls = () => invokeMock.mock.calls.filter(([channel, req]) => channel === 'agent:submit' && (req as { type?: string }).type === 'thread.clear')

const renderChat = () => render(<PersonaChat contactId="wxid_test" name="小明" threadId="thr_persona" onThreadId={() => {}} onSaveSample={async () => {}} />)

/** Right-click the assistant bubble → 清空试聊记录 → returns the confirmation dialog. */
async function openClearFromMenu(): Promise<HTMLElement> {
  fireEvent.contextMenu(await screen.findByText(REPLY))
  fireEvent.click(await screen.findByRole('menuitem', { name: '清空试聊记录' }))
  return await screen.findByRole('dialog')
}

describe('PersonaChat 清空试聊记录', () => {
  it('opens a DangerDialog instead of clearing at once; 取消 keeps the transcript', async () => {
    renderChat()
    const dialog = await openClearFromMenu()
    expect(within(dialog).getByText('清空试聊记录？')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '清空' })).toBeTruthy()
    expect(clearCalls()).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(clearCalls()).toHaveLength(0)
    expect(screen.getByText(REPLY)).toBeTruthy()
  })

  it('submits thread.clear only after 清空 is confirmed, then empties the transcript', async () => {
    renderChat()
    const dialog = await openClearFromMenu()
    fireEvent.click(within(dialog).getByRole('button', { name: '清空' }))

    await waitFor(() => expect(clearCalls()).toHaveLength(1))
    expect(clearCalls()[0]?.[1]).toMatchObject({ type: 'thread.clear', threadId: 'thr_persona' })
    await waitFor(() => expect(screen.queryByText(REPLY)).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
