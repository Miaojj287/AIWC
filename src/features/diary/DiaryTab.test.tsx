// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from '@aiwc/protocol'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge } from '@/platform/mockBridge'
import { DiaryTab } from './DiaryTab'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Floating UI probes ancestors with `:popover-open` / `:modal`, which jsdom's selector engine recurses on
// for seconds per menu open (see PersonaChat.test.tsx); jsdom has no top layer, so answer those directly.
const nativeMatches = Element.prototype.matches
const TOP_LAYER = new Set([':popover-open', ':modal'])

const TODAY = '2026-09-13'
const EARLIER = '2026-09-01'
const entry = (date: string): DiaryEntry => ({
  date,
  markdown: `今天的记录 ${date}`,
  cues: [],
  sources: { sessions: [], messageCount: 0, agentTurns: 0 },
  generatedAt: Date.UTC(2026, 8, 13, 2),
})

let generated: Array<{ date: string; force?: boolean }>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 13, 10, 0, 0))
  Element.prototype.matches = function (this: Element, selector: string) {
    return TOP_LAYER.has(selector) ? false : nativeMatches.call(this, selector)
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  generated = []
  const bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  bridge.handlers['diary:list'] = () => [TODAY, EARLIER].map((date) => ({ date, generatedAt: 0 }))
  bridge.handlers['diary:get'] = ({ date }) => entry(date)
  bridge.handlers['diary:generate'] = (req) => {
    generated.push(req)
    return entry(req.date)
  }
  __setBridgeForTests(bridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Element.prototype.matches = nativeMatches
})

const TAB = { id: 'diary:diary', kind: 'diary', objectId: 'diary', title: 'diary' } as const
const renderDiary = () => render(<DiaryTab tab={TAB} active update={() => {}} requestClose={() => {}} />)

/** Every way to regenerate an existing entry, each ending on the confirm dialog's 重新生成 button. */
const ENTRY_POINTS: Array<[string, string, () => Promise<void>]> = [
  [
    'the date menu',
    EARLIER,
    async () => {
      fireEvent.contextMenu(await screen.findByText(EARLIER))
      fireEvent.click(await screen.findByRole('menuitem', { name: '重新生成' }))
    },
  ],
  [
    '重新生成今天',
    TODAY,
    async () => {
      fireEvent.click(await screen.findByRole('button', { name: '重新生成今天' }))
    },
  ],
  [
    'the header button',
    TODAY,
    async () => {
      await screen.findByText(`今天的记录 ${TODAY}`)
      fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    },
  ],
]

describe('DiaryTab 重新生成', () => {
  it.each(ENTRY_POINTS)('%s asks before overwriting; 取消 generates nothing', async (_name, _date, trigger) => {
    renderDiary()
    await trigger()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/^重新生成 .+ 的日记？$/)).toBeTruthy()
    expect(generated).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(generated).toEqual([])
  })

  it.each(ENTRY_POINTS)('%s regenerates its own date once confirmed', async (_name, date, trigger) => {
    renderDiary()
    await trigger()

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '重新生成' }))

    await waitFor(() => expect(generated).toEqual([{ date, force: true }]))
  })
})
