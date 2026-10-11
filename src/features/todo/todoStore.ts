/**
 * 每日待办 as the renderer sees it (zustand): the checklist from todo:list and the scan status from
 * todo:status, kept live by the 'todo:changed' / 'todo:progress' pushes — one subscription per window,
 * started by whichever surface (rail list, dashboard, empty state) mounts first.
 *
 * The actions (check, edit, delete with 撤销, add, clear, scan) live here too, so the dashboard rows,
 * their menus and the object list all go through the same code and the same feedback.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { TodoItem, TodoProgress, TodoStatus } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { getBridge } from '@/platform/bridge'
import { invoke } from '@/platform/hooks'
import { scanOutcome } from './todoModel'

interface TodoState {
  items: TodoItem[]
  status?: TodoStatus
  loaded: boolean
  loading: boolean
  error?: Error
  /** Progress of the scan in flight (any trigger); cleared when it finishes. */
  progress?: TodoProgress
  load(): Promise<void>
  loadStatus(): Promise<void>
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
const errorText = (e: unknown): string => toError(e).message

export const useTodoStore = create<TodoState>((set) => ({
  items: [],
  loaded: false,
  loading: false,

  async load() {
    set({ loading: true })
    try {
      const items = await invoke('todo:list', undefined)
      set({ items, loaded: true, loading: false, error: undefined })
    } catch (e) {
      set({ loading: false, error: toError(e) })
    }
  },

  async loadStatus() {
    try {
      const status = await invoke('todo:status', undefined)
      set((s) => ({ status, progress: status.running ? s.progress : undefined }))
    } catch {
      /* the header keeps the status it has; the next push refreshes it */
    }
  },
}))

let subscription: Promise<void> | undefined

export function ensureTodoSubscription(): Promise<void> {
  subscription ??= getBridge()
    .then((bridge) => {
      bridge.on('todo:changed', ({ scope }) => {
        const store = useTodoStore.getState()
        if (scope !== 'status') void store.load()
        void store.loadStatus()
      })
      bridge.on('todo:progress', (progress) => {
        useTodoStore.setState((s) => ({
          progress,
          status: s.status && !s.status.running ? { ...s.status, running: true } : s.status,
        }))
      })
      const store = useTodoStore.getState()
      return Promise.all([store.load(), store.loadStatus()]).then(() => undefined)
    })
    .catch(() => {
      subscription = undefined
    })
  return subscription
}

export function useTodos(): Pick<TodoState, 'items' | 'status' | 'loaded' | 'loading' | 'error' | 'progress'> {
  useEffect(() => {
    void ensureTodoSubscription()
  }, [])
  const items = useTodoStore((s) => s.items)
  const status = useTodoStore((s) => s.status)
  const loaded = useTodoStore((s) => s.loaded)
  const loading = useTodoStore((s) => s.loading)
  const error = useTodoStore((s) => s.error)
  const progress = useTodoStore((s) => s.progress)
  return { items, status, loaded, loading, error, progress }
}

const replaceItem = (item: TodoItem) =>
  useTodoStore.setState((s) => ({ items: s.items.map((i) => (i.id === item.id ? item : i)) }))

/** Check / uncheck at once; the list rolls back and says so when the write fails. */
export async function setTodoDone(item: TodoItem, done: boolean): Promise<void> {
  replaceItem({ ...item, done, ...(done ? { doneAt: Date.now() } : { doneAt: undefined }) })
  try {
    replaceItem(await invoke('todo:update', { id: item.id, done }))
  } catch (e) {
    replaceItem(item)
    toast.error(t('todo.toast.updateFailed'), { detail: errorText(e) })
  }
}

export async function editTodo(item: TodoItem, text: string): Promise<boolean> {
  const clean = text.trim()
  if (!clean || clean === item.text) return true
  try {
    replaceItem(await invoke('todo:update', { id: item.id, text: clean }))
    return true
  } catch (e) {
    toast.error(t('todo.toast.updateFailed'), { detail: errorText(e) })
    return false
  }
}

export async function addTodo(text: string): Promise<boolean> {
  const clean = text.trim()
  if (!clean) return false
  try {
    const item = await invoke('todo:add', { text: clean })
    useTodoStore.setState((s) => ({ items: [item, ...s.items.filter((i) => i.id !== item.id)] }))
    return true
  } catch (e) {
    toast.error(t('todo.toast.addFailed'), { detail: errorText(e) })
    return false
  }
}

/** Delete one item; the toast's 撤销 puts the same item back (id, source and check state included). */
export async function removeTodo(item: TodoItem): Promise<void> {
  const before = useTodoStore.getState().items
  useTodoStore.setState({ items: before.filter((i) => i.id !== item.id) })
  try {
    const removed = await invoke('todo:remove', { id: item.id })
    toast.success(t('todo.toast.removed'), {
      detail: item.text,
      action: removed ? { label: t('todo.toast.undo'), onClick: () => void restoreTodo(removed) } : undefined,
    })
  } catch (e) {
    useTodoStore.setState({ items: before })
    toast.error(t('todo.toast.removeFailed'), { detail: errorText(e) })
  }
}

async function restoreTodo(item: TodoItem): Promise<void> {
  try {
    const restored = await invoke('todo:restore', { item })
    useTodoStore.setState((s) => ({ items: [restored, ...s.items.filter((i) => i.id !== restored.id)] }))
  } catch (e) {
    toast.error(t('todo.toast.restoreFailed'), { detail: errorText(e) })
  }
}

export async function clearDoneTodos(): Promise<void> {
  try {
    const { removed } = await invoke('todo:clearDone', undefined)
    useTodoStore.setState((s) => ({ items: s.items.filter((i) => !i.done) }))
    toast.success(t('todo.toast.cleared', { n: removed }))
  } catch (e) {
    toast.error(t('todo.toast.clearFailed'), { detail: errorText(e) })
  }
}

/** 立即扫描 (all picked chats, or the given ones); the result is always reported. */
export async function scanTodos(sourceIds?: string[]): Promise<void> {
  useTodoStore.setState((s) => ({
    status: s.status ? { ...s.status, running: true } : s.status,
    progress: undefined,
  }))
  try {
    const result = await invoke('todo:scan', sourceIds ? { sourceIds } : undefined)
    const outcome = scanOutcome(result, t)
    toast[outcome.kind](outcome.text, outcome.detail ? { detail: outcome.detail } : undefined)
  } catch (e) {
    toast.error(t('todo.failure.failed'), { detail: errorText(e) })
  } finally {
    useTodoStore.setState({ progress: undefined })
    const store = useTodoStore.getState()
    await Promise.all([store.load(), store.loadStatus()])
  }
}

export async function cancelTodoScan(): Promise<void> {
  try {
    await invoke('todo:cancelScan', undefined)
  } catch (e) {
    toast.error(t('todo.toast.cancelFailed'), { detail: errorText(e) })
  }
}

/** Tests: drop the loaded list and the bridge subscription (the next mount subscribes again). */
export function __resetTodoStoreForTests(): void {
  subscription = undefined
  useTodoStore.setState({
    items: [],
    status: undefined,
    loaded: false,
    loading: false,
    error: undefined,
    progress: undefined,
  })
}
