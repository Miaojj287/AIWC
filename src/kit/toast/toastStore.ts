/**
 * Toast store — framework-free (useSyncExternalStore in <Toaster/>), so features and the shell can
 * push toasts from anywhere. Rules (CLAUDE.md §4.6): bottom-right, 4 s auto-dismiss, sticky when it
 * carries an action or is marked sticky; `progress` toasts are sticky by default and get updated.
 */
export type ToastKind = 'success' | 'info' | 'warning' | 'error' | 'progress'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  id?: string
  kind: ToastKind
  text: string
  /** Secondary line (12px weak). */
  detail?: string
  action?: ToastAction
  /** Do not auto-dismiss. Implied by `action` and by kind `progress`. */
  sticky?: boolean
  /** Auto-dismiss delay in ms (default 4000). */
  durationMs?: number
}

export interface ToastItem extends Required<Pick<ToastInput, 'id' | 'kind' | 'text'>> {
  detail?: string
  action?: ToastAction
  sticky: boolean
  durationMs: number
  createdAt: number
}

export const TOAST_DEFAULT_DURATION = 4000
export const TOAST_MAX_VISIBLE = 5

type Listener = () => void

let items: ToastItem[] = []
const listeners = new Set<Listener>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let seq = 0

const emit = () => {
  for (const l of listeners) l()
}

const clearTimer = (id: string) => {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

const arm = (item: ToastItem) => {
  clearTimer(item.id)
  if (item.sticky) return
  timers.set(
    item.id,
    setTimeout(() => {
      timers.delete(item.id)
      dismiss(item.id)
    }, item.durationMs),
  )
}

const resolveSticky = (input: ToastInput) => input.sticky ?? (Boolean(input.action) || input.kind === 'progress')

/** Add (or replace, when `id` matches) a toast. Returns its id. */
export function addToast(input: ToastInput): string {
  const id = input.id ?? `toast_${++seq}`
  const existing = items.find((t) => t.id === id)
  const item: ToastItem = {
    id,
    kind: input.kind,
    text: input.text,
    detail: input.detail,
    action: input.action,
    sticky: resolveSticky(input),
    durationMs: input.durationMs ?? TOAST_DEFAULT_DURATION,
    createdAt: existing?.createdAt ?? Date.now(),
  }
  items = existing ? items.map((t) => (t.id === id ? item : t)) : [...items, item]
  if (items.length > TOAST_MAX_VISIBLE) {
    for (const dropped of items.slice(0, items.length - TOAST_MAX_VISIBLE)) clearTimer(dropped.id)
    items = items.slice(items.length - TOAST_MAX_VISIBLE)
  }
  arm(item)
  emit()
  return id
}

/** Patch an existing toast (e.g. progress text → success). Re-arms the timer with the new stickiness. */
export function updateToast(id: string, patch: Partial<Omit<ToastInput, 'id'>>): void {
  const current = items.find((t) => t.id === id)
  if (!current) return
  const merged: ToastInput = { ...current, ...patch, id }
  addToast(merged)
}

export function dismissToast(id: string): void {
  dismiss(id)
}

function dismiss(id: string) {
  clearTimer(id)
  if (!items.some((t) => t.id === id)) return
  items = items.filter((t) => t.id !== id)
  emit()
}

export function clearToasts(): void {
  for (const id of timers.keys()) clearTimeout(timers.get(id))
  timers.clear()
  if (items.length === 0) return
  items = []
  emit()
}

/** Pause the auto-dismiss timer (hover). */
export function pauseToast(id: string): void {
  clearTimer(id)
}

/** Resume the auto-dismiss timer after hover. */
export function resumeToast(id: string): void {
  const item = items.find((t) => t.id === id)
  if (item) arm(item)
}

export function getToasts(): ToastItem[] {
  return items
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Convenience: one function per kind. */
export const toast = Object.assign(
  (input: ToastInput) => addToast(input),
  {
    success: (text: string, opts?: Omit<ToastInput, 'kind' | 'text'>) => addToast({ kind: 'success', text, ...opts }),
    info: (text: string, opts?: Omit<ToastInput, 'kind' | 'text'>) => addToast({ kind: 'info', text, ...opts }),
    warning: (text: string, opts?: Omit<ToastInput, 'kind' | 'text'>) => addToast({ kind: 'warning', text, ...opts }),
    error: (text: string, opts?: Omit<ToastInput, 'kind' | 'text'>) => addToast({ kind: 'error', text, ...opts }),
    progress: (text: string, opts?: Omit<ToastInput, 'kind' | 'text'>) => addToast({ kind: 'progress', text, ...opts }),
    update: updateToast,
    dismiss: dismissToast,
    clear: clearToasts,
  },
)
