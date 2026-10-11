/**
 * todo:* — 每日待办. The checklist and day summaries come from the store, scans from the scanner; every
 * change is pushed on 'todo:changed' so a second window (or the Agent window's workspace pane) follows.
 * Renderer input is untrusted: ids, dates, text and restored items are validated before they reach disk.
 */
import { TODO_ID_RE, TODO_MAX_SOURCES, TODO_TEXT_MAX, TodoItemSchema, isTodoDate } from '@aiwc/protocol'
import { TodoNotFoundError } from '@aiwc/memory'
import { z } from 'zod'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

const TextSchema = z.string().trim().min(1).max(TODO_TEXT_MAX)
const SourceIdsSchema = z.array(z.string().min(1).max(200)).max(TODO_MAX_SOURCES)

export function registerTodoIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { store, scanner } = ctx.todo
  const changed = () => ctx.broadcast('todo:changed', { scope: 'items' })
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !TODO_ID_RE.test(value)) throw new Error(t('main.todo.invalidRequest'))
    return value
  }
  const text = (value: unknown): string => {
    const parsed = TextSchema.safeParse(value)
    if (!parsed.success) throw new Error(t('main.todo.invalidText', { max: TODO_TEXT_MAX }))
    return parsed.data
  }
  /** Run a store mutation, translate "gone" into a sentence and tell every window. */
  const mutate = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      const out = await fn()
      changed()
      return out
    } catch (e) {
      if (e instanceof TodoNotFoundError) throw new Error(t('main.todo.notFound'), { cause: e })
      throw e
    }
  }

  handle('todo:list', () => store.list())
  handle('todo:add', (req) => mutate(() => store.add(text(req.text))))
  handle('todo:update', (req) => {
    const patch: { done?: boolean; text?: string } = {}
    if (req.done !== undefined) {
      if (typeof req.done !== 'boolean') throw new Error(t('main.todo.invalidRequest'))
      patch.done = req.done
    }
    if (req.text !== undefined) patch.text = text(req.text)
    return mutate(() => store.update(id(req.id), patch))
  })
  handle('todo:remove', (req) => mutate(() => store.remove(id(req.id))))
  handle('todo:restore', (req) => {
    const parsed = TodoItemSchema.safeParse(req.item)
    if (!parsed.success) throw new Error(t('main.todo.invalidRequest'))
    return mutate(() => store.restore(parsed.data))
  })
  handle('todo:clearDone', () => mutate(async () => ({ removed: await store.clearDone() })))
  handle('todo:days', () => store.days())
  handle('todo:day', (req) => {
    if (!isTodoDate(req.date)) throw new Error(t('main.todo.invalidRequest'))
    return store.getDay(req.date)
  })
  handle('todo:status', () => scanner.status())
  handle('todo:scan', (req) => {
    const ids = req?.sourceIds === undefined ? undefined : SourceIdsSchema.safeParse(req.sourceIds)
    if (ids && !ids.success) throw new Error(t('main.todo.invalidRequest'))
    return scanner.scan({ trigger: 'manual', ...(ids?.data ? { sourceIds: ids.data } : {}) })
  })
  handle('todo:cancelScan', () => scanner.cancel())
}
