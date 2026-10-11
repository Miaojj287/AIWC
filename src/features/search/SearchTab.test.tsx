// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { AiwcBridge, ConnectionState, SearchHit, SearchQuery, WxMessage, WxSession } from '@aiwc/protocol'
import { onCommand, runCommand, type CommandMap } from '@/app/commands'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { clearToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { useTabsStore } from '@/workspace/tabsStore'
import { register } from './index'
import { __resetRecentSearchesForTests } from './recentSearches'
import { SearchTab } from './SearchTab'
import { PAGE_SIZE } from './searchModel'

vi.mock('virtua', () => ({
  VList: ({
    data,
    children,
    'aria-label': label,
  }: {
    data: readonly unknown[]
    children: (item: unknown) => ReactNode
    'aria-label'?: string
  }) => <div aria-label={label}>{data.map(children)}</div>,
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Floating UI probes ancestors with `:popover-open` / `:modal`, which jsdom's selector engine recurses on for seconds
// per menu open (see ContactList.test.tsx); jsdom has no top layer, so answer those directly.
const nativeMatches = Element.prototype.matches
const TOP_LAYER = new Set([':popover-open', ':modal'])

const GROUP = 'g1@chatroom'
const DM = 'wxid_friend'
const T = new Date('2026-10-01T12:00:00').getTime()

const sessions: Record<string, WxSession> = {
  [GROUP]: { id: GROUP, kind: 'group', title: '项目群', unread: 0, pinned: false, muted: false },
  [DM]: { id: DM, kind: 'dm', title: '小王', unread: 0, pinned: false, muted: false },
}

function hit(sessionId: string, id: string, createdAt: number, snippet: string, over: Partial<WxMessage> = {}) {
  const message: WxMessage = {
    id,
    sessionId,
    seq: createdAt,
    createdAt,
    senderId: `sender_${id}`,
    senderName: 'Sender',
    isSelf: false,
    kind: 'text',
    text: snippet.replace(/[[\]…]/g, ''),
    anchor: { sessionId, messageId: id, seq: createdAt, createdAt },
    ...over,
  }
  const out: SearchHit = { message, score: 1, snippet, source: 'fts' }
  return out
}

const HITS: SearchHit[] = [
  hit(GROUP, 'm1', T, '…周五[聚餐]改到周六…', { senderName: '李明' }),
  hit(DM, 'm2', T - 60_000, '[聚餐]的地方订好了', { senderName: undefined }),
  hit(GROUP, 'm3', T - 120_000, '上次[聚餐]的照片', { isSelf: true }),
]

let connection: ConnectionState
let searches: SearchQuery[]
let searchImpl: (q: SearchQuery) => Promise<SearchHit[]>

beforeEach(() => {
  Element.prototype.matches = function (this: Element, selector: string) {
    return TOP_LAYER.has(selector) ? false : nativeMatches.call(this, selector)
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  connection = 'ready'
  searches = []
  searchImpl = async () => HITS
  localStorage.clear()
  __resetRecentSearchesForTests()
  useTabsStore.setState({ tabs: [], activeId: null, recentlyClosed: [], lastActiveByFunction: {}, openSeq: 0 })
  clearToasts()
  const bridge = {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: vi.fn(async (channel: string, request: unknown) => {
      switch (channel) {
        case 'substrate:status':
          return { connection, sync: { phase: 'idle' } }
        case 'substrate:search':
          searches.push(request as SearchQuery)
          return searchImpl(request as SearchQuery)
        case 'substrate:getSession':
          return sessions[(request as { id: string }).id]
        case 'substrate:listSessions':
          return { items: Object.values(sessions), total: 2, hasMore: false }
        default:
          throw new Error(`unexpected ${channel}`)
      }
    }),
  } as unknown as AiwcBridge
  __setBridgeForTests(bridge)
  register()
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetLanguageForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Element.prototype.matches = nativeMatches
})

/** The tab as the workspace hosts it: read from the tab store, writing back through it. */
function Harness() {
  const tab = useTabsStore((s) => s.tabs.find((x) => x.kind === 'search'))
  if (!tab) return null
  return (
    <SearchTab
      tab={tab}
      active
      update={(patch) => useTabsStore.getState().update(tab.id, patch)}
      requestClose={() => {}}
    />
  )
}

/** Open the tab through the real command handler, render it and let the status call settle. */
async function openWith(payload: CommandMap['tab.openSearch'] = {}) {
  runCommand('tab.openSearch', payload)
  render(<Harness />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Result rows (chat and hit rows), not the `···` buttons inside them. */
const resultRowsOnScreen = () =>
  within(screen.getByLabelText('搜索结果'))
    .getAllByRole('button')
    .filter((el) => el.getAttribute('tabindex') === '0')

const box = () => screen.getByRole('searchbox', { name: '在全部聊天记录中搜索' })

describe('SearchTab', () => {
  it('searches every chat locally and groups the hits by chat', async () => {
    await openWith({ query: '聚餐' })

    expect(await screen.findByText('3 条结果 · 2 个聊天')).toBeTruthy()
    expect(searches).toEqual([{ query: '聚餐', limit: PAGE_SIZE, mode: 'keyword', match: 'exact' }])
    expect(screen.queryByRole('note')).toBeNull()
    await screen.findByText('项目群')
    // Chat rows in rank order, each followed by its hits newest first, with the matched words marked.
    const texts = resultRowsOnScreen().map((row) => row.textContent ?? '')
    expect(texts).toHaveLength(5)
    expect(texts[0]).toContain('项目群')
    expect(texts[0]).toContain('2 条相关记录')
    expect(texts[1]).toContain('李明')
    expect(texts[2]).toContain('我')
    expect(texts[3]).toContain('1 条相关记录')
    // A direct chat's message without a stored sender name is from the chat itself.
    expect(texts[4]).toContain('小王')
    expect(screen.getAllByText('聚餐', { selector: 'mark' })).toHaveLength(3)
  })

  it('reuses the one tab and searches again when asked with a new query', async () => {
    await openWith({ query: '聚餐' })
    await act(async () => runCommand('tab.openSearch', { query: '合同', sessionIds: [GROUP] }))

    expect(useTabsStore.getState().tabs.filter((x) => x.kind === 'search')).toHaveLength(1)
    expect((box() as HTMLInputElement).value).toBe('合同')
    expect(searches.at(-1)).toMatchObject({ query: '合同', sessionIds: [GROUP] })
  })

  it('opens the chat scrolled to the hit', async () => {
    const opened = vi.fn()
    const off = onCommand('tab.openChat', opened)
    await openWith({ query: '聚餐' })
    await screen.findByText('项目群')

    const mark = screen.getAllByText('聚餐', { selector: 'mark' })[0]!
    fireEvent.click(mark.closest('[role="button"]')!)
    expect(opened).toHaveBeenCalledWith({ sessionId: GROUP, title: '项目群', focusMessageId: 'm1' })
    off()
  })

  it('narrows to one chat from a hit and offers to clear the filters when nothing matches', async () => {
    await openWith({ query: '聚餐' })
    searchImpl = async () => []
    // The second mark is the older hit of 项目群; right-click opens the same menu as its `···`.
    const row = (await screen.findAllByText('聚餐', { selector: 'mark' }))[1]!.closest('[role="button"]')!
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByRole('menuitem', { name: '只搜这个聊天' }))

    expect(await screen.findByText('没有找到「聚餐」')).toBeTruthy()
    expect(searches.at(-1)).toMatchObject({ query: '聚餐', sessionIds: [GROUP] })
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await act(async () => {})
    expect(searches.at(-1)).toEqual({ query: '聚餐', limit: PAGE_SIZE, mode: 'keyword', match: 'exact' })
  })

  it('shows a failure with 重试', async () => {
    searchImpl = async () => {
      throw new Error('index busy')
    }
    await openWith({ query: '聚餐' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('搜索失败')
    expect(alert.textContent).toContain('index busy')

    searchImpl = async () => HITS
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('3 条结果 · 2 个聊天')).toBeTruthy()
  })

  it('asks to connect WeChat instead of searching when there is no connection', async () => {
    connection = 'no_config'
    const openSettings = vi.fn()
    const off = onCommand('tab.openSettings', openSettings)
    await openWith({ query: '聚餐' })

    expect(screen.getByText('尚未连接微信')).toBeTruthy()
    expect(searches).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '连接微信' }))
    expect(openSettings).toHaveBeenCalledWith({ page: 'account' })
    off()
  })

  it('starts from the hint and the recent searches, and a recent search runs again', async () => {
    localStorage.setItem('aiwc.search.recent', JSON.stringify(['周会', '合同']))
    __resetRecentSearchesForTests()
    await openWith()

    expect(screen.getByText('在全部聊天记录中搜索', { selector: 'div' })).toBeTruthy()
    expect(searches).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /^周会/ }))
    expect(await screen.findByText('3 条结果 · 2 个聊天')).toBeTruthy()
    expect(searches.at(-1)).toMatchObject({ query: '周会' })
    expect((box() as HTMLInputElement).value).toBe('周会')
  })

  it('searches live after a pause from two characters, and at once on Enter', async () => {
    await openWith()
    vi.useFakeTimers()

    fireEvent.change(box(), { target: { value: '聚' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searches).toEqual([])

    fireEvent.change(box(), { target: { value: '聚餐' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searches.map((q) => q.query)).toEqual(['聚餐'])

    fireEvent.change(box(), { target: { value: '饭' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(searches.map((q) => q.query)).toEqual(['聚餐', '饭'])
    expect(JSON.parse(localStorage.getItem('aiwc.search.recent') ?? '[]')).toEqual(['饭'])
  })

  it('loads a bigger page for 加载更多 while the first page was full', async () => {
    searchImpl = async (q) => Array.from({ length: q.limit }, (_, i) => hit(GROUP, `m${i}`, T - i, `[聚餐] ${i}`))
    await openWith({ query: '聚餐' })
    expect(await screen.findByText(`前 ${PAGE_SIZE} 条结果 · 1 个聊天`)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }))
    expect(await screen.findByText(`前 ${PAGE_SIZE * 2} 条结果 · 1 个聊天`)).toBeTruthy()
    expect(searches.map((q) => q.limit)).toEqual([PAGE_SIZE, PAGE_SIZE * 2])
  })

  it('speaks English when the UI does', async () => {
    setLanguage('en-US')
    await openWith({ query: '聚餐' })
    expect(await screen.findByText('3 results in 2 chats')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search all chat history' })).toBeTruthy()
  })
})
