/**
 * todo:* for the mock bridge (tests + browser previews): the checklist lives in localStorage; a scan
 * walks the picked chats of the demo dataset, pushes 'todo:progress' per chat, turns messages that
 * look like asks into to-dos and writes a canned summary per chat. No model is involved; nothing here
 * is used by the desktop app.
 */
import {
  TodoItemSchema,
  todoDateOf,
  type TodoChatSummary,
  type TodoDay,
  type TodoItem,
  type TodoScanResult,
} from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'
import { searchableText } from './dataset'

const ITEMS_KEY = 'aiwc.mock.todo.items'
const DAYS_KEY = 'aiwc.mock.todo.days'
const LAST_KEY = 'aiwc.mock.todo.last'
const STEP_DELAY_MS = 500
const HOUR = 3_600_000
/** Demo heuristic for "someone asked me to do something". */
const ASK_RE = /记得|麻烦|帮我|帮忙|请|需要|之前|截止|提交|回复|确认|明天|周[一二三四五六日]/

export function todoHandlers(ctx: MockContext): HandlersFor<'todo'> {
  // Held in memory and written through: the KV forgets everything when there is no storage (tests).
  let itemList = ctx.kv.get<TodoItem[]>(ITEMS_KEY, [])
  let dayMap = ctx.kv.get<Record<string, TodoDay>>(DAYS_KEY, {})
  let lastResult = ctx.kv.get<TodoScanResult | undefined>(LAST_KEY, undefined)
  const items = (): TodoItem[] => itemList
  const saveItems = (list: TodoItem[]) => {
    itemList = list
    ctx.kv.set(ITEMS_KEY, list)
    ctx.emit('todo:changed', { scope: 'items' })
  }
  const days = (): Record<string, TodoDay> => dayMap
  const last = (): TodoScanResult | undefined => lastResult
  let running: AbortController | undefined
  let seq = 0
  const newId = () => `mock${ctx.now().toString(36)}${(seq++).toString(36)}`

  const find = (id: string): TodoItem => {
    const item = items().find((i) => i.id === id)
    if (!item) throw new Error('这条待办已不存在')
    return item
  }

  async function scan(sourceIds: string[] | undefined, signal: AbortSignal): Promise<TodoScanResult> {
    const cfg = ctx.config().todo
    const startedAt = ctx.now()
    const base = { trigger: 'manual' as const, startedAt, scanned: 0, failed: 0, messages: 0, added: 0 }
    if (!cfg.enabled) return { ...base, ok: false, failure: 'disabled', finishedAt: ctx.now() }
    const sources = cfg.sources.filter((s) => !sourceIds || sourceIds.includes(s.id))
    if (sources.length === 0) return { ...base, ok: false, failure: 'no_sources', finishedAt: ctx.now() }
    ctx.emit('todo:progress', { step: 'collect', done: 0, total: sources.length })
    await ctx.delay(STEP_DELAY_MS, signal)
    const found: TodoItem[] = []
    const summaries: TodoChatSummary[] = []
    let messages = 0
    for (const [i, source] of sources.entries()) {
      // The demo dataset is historical: read the chat's latest day instead of "since the last scan".
      const list = ctx.data.messagesBySession.get(source.id) ?? []
      const lastAt = list[list.length - 1]?.createdAt ?? startedAt
      const recent = list.filter((m) => m.createdAt > lastAt - 24 * HOUR && searchableText(m).length > 3)
      messages += recent.length
      const title = ctx.data.sessions.get(source.id)?.title ?? source.title
      for (const m of recent.filter((m) => !m.isSelf && ASK_RE.test(searchableText(m))).slice(-2)) {
        found.push({
          id: newId(),
          text: searchableText(m).slice(0, 60),
          origin: 'scan',
          sourceId: source.id,
          sourceTitle: title,
          messageId: m.id,
          messageAt: m.createdAt,
          createdAt: ctx.now(),
          done: false,
        })
      }
      if (recent.length)
        summaries.push({
          sourceId: source.id,
          title,
          summary: `「${title}」最近一天有 ${recent.length} 条消息，${recent[0]?.senderName ?? '群友'}等人在聊：${searchableText(recent[recent.length - 1]!).slice(0, 40)}。`,
          messageCount: recent.length,
          from: recent[0]?.createdAt ?? startedAt,
          to: recent[recent.length - 1]?.createdAt ?? startedAt,
          updatedAt: ctx.now(),
        })
      await ctx.delay(STEP_DELAY_MS, signal)
      ctx.emit('todo:progress', { step: 'summarize', done: i + 1, total: sources.length, source: title })
    }
    ctx.emit('todo:progress', { step: 'save', done: sources.length, total: sources.length })
    const existing = items()
    const fresh = found.filter((f) => !existing.some((e) => e.sourceId === f.sourceId && e.text === f.text))
    if (fresh.length) saveItems([...fresh, ...existing])
    if (summaries.length) {
      const date = todoDateOf(startedAt)
      const all = days()
      const kept = (all[date]?.chats ?? []).filter((c) => !summaries.some((s) => s.sourceId === c.sourceId))
      dayMap = { ...all, [date]: { date, chats: [...summaries, ...kept], updatedAt: ctx.now() } }
      ctx.kv.set(DAYS_KEY, dayMap)
    }
    return { ...base, ok: true, scanned: sources.length, messages, added: fresh.length, finishedAt: ctx.now() }
  }

  return {
    'todo:list': () => items(),
    'todo:add': ({ text }) => {
      const item = TodoItemSchema.parse({ id: newId(), text, origin: 'user', createdAt: ctx.now(), done: false })
      saveItems([item, ...items()])
      return item
    },
    'todo:update': ({ id, done, text }) => {
      const current = find(id)
      const next: TodoItem = { ...current, ...(text !== undefined ? { text: text.trim() } : {}) }
      if (done !== undefined && done !== current.done) {
        next.done = done
        if (done) next.doneAt = ctx.now()
        else delete next.doneAt
      }
      saveItems(items().map((i) => (i.id === id ? next : i)))
      return next
    },
    'todo:remove': ({ id }) => {
      const removed = items().find((i) => i.id === id)
      if (removed) saveItems(items().filter((i) => i.id !== id))
      return removed
    },
    'todo:restore': ({ item }) => {
      const valid = TodoItemSchema.parse(item)
      if (!items().some((i) => i.id === valid.id)) saveItems([valid, ...items()])
      return valid
    },
    'todo:clearDone': () => {
      const all = items()
      const open = all.filter((i) => !i.done)
      saveItems(open)
      return { removed: all.length - open.length }
    },
    'todo:days': () => Object.keys(days()).sort((a, b) => (a < b ? 1 : -1)),
    'todo:day': ({ date }) => days()[date],
    'todo:status': () => {
      const cfg = ctx.config().todo
      const result = last()
      return {
        enabled: cfg.enabled,
        sources: cfg.sources.length,
        running: running !== undefined,
        ...(result ? { last: result } : {}),
        ...(cfg.enabled && cfg.sources.length && cfg.schedule.kind !== 'manual'
          ? { nextRunAt: ctx.now() + (cfg.schedule.kind === 'hourly' ? cfg.schedule.everyHours : 24) * HOUR }
          : {}),
      }
    },
    'todo:scan': async (req) => {
      const startedAt = ctx.now()
      if (running)
        return {
          ok: false,
          failure: 'busy',
          trigger: 'manual',
          startedAt,
          finishedAt: startedAt,
          scanned: 0,
          failed: 0,
          messages: 0,
          added: 0,
        }
      const controller = new AbortController()
      running = controller
      try {
        const result = await scan(req?.sourceIds, controller.signal)
        if (result.ok || (result.failure !== 'disabled' && result.failure !== 'no_sources')) {
          lastResult = result
          ctx.kv.set(LAST_KEY, result)
        }
        return result
      } catch {
        return {
          ok: false,
          failure: 'cancelled',
          trigger: 'manual',
          startedAt,
          finishedAt: ctx.now(),
          scanned: 0,
          failed: 0,
          messages: 0,
          added: 0,
        }
      } finally {
        running = undefined
        ctx.emit('todo:changed', { scope: 'all' })
      }
    },
    'todo:cancelScan': () => {
      if (!running) return false
      running.abort()
      return true
    },
  }
}
