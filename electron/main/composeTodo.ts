/**
 * 每日待办 wiring for the composition root: the store under <dataRoot>/todo, the scanner over the
 * substrate and the model resolver, and how scans reach the user — 'todo:progress' / 'todo:changed'
 * pushes, plus a toast for scans the user did not start (a manual scan answers its own IPC call).
 * The schedule follows config: turning the feature off (or removing the last chat) disarms it and
 * cancels a scan in progress.
 */
import type {
  ModelClient,
  ModelSelection,
  SubstrateService,
  TodoConfig,
  TodoScanResult,
  ToastPayload,
} from '@aiwc/protocol'
import { createTodoScanner, createTodoStore, type TodoScanner, type TodoStore } from '@aiwc/memory'
import type { Broadcast } from './contracts'
import { t } from './i18n'

type PkgLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export interface ComposeTodoDeps {
  dir: string
  substrate: SubstrateService
  resolveModel(selection: ModelSelection | undefined): Promise<ModelClient>
  config(): TodoConfig
  /** Subscribe to config changes; returns the unsubscribe. */
  onConfigChange(listener: () => void): () => void
  broadcast: Broadcast
  toast(payload: ToastPayload): void
  logger: PkgLogger
}

export interface TodoService {
  start(): void
  store: TodoStore
  scanner: TodoScanner
  /** Unsubscribe from config and stop the scanner (shutdown). */
  dispose(): void
}

/** What arms the schedule; other fields (model, message cap) are read when a scan starts. */
const scheduleKey = (c: TodoConfig) => JSON.stringify([c.enabled, c.sources.map((s) => s.id), c.schedule])

/** Toast for a scan nobody pressed a button for: new todos, or the first failure after a success. */
export function unattendedScanToast(
  result: TodoScanResult,
  previous: TodoScanResult | undefined,
): ToastPayload | undefined {
  if (result.trigger === 'manual') return undefined
  const view = { label: t('main.todo.view'), command: 'tab.openTodo' }
  if (result.ok) {
    if (result.added === 0) return undefined
    return { kind: 'success', text: t('main.todo.added', { n: result.added }), action: view }
  }
  if (result.failure === 'cancelled' || result.failure === 'busy') return undefined
  // A schedule that keeps failing (no key for a week) says so once, not every hour.
  if (previous && !previous.ok && previous.failure === result.failure) return undefined
  if (result.failure === 'model_unavailable')
    return {
      kind: 'error',
      text: t('main.todo.modelUnavailable'),
      sticky: true,
      action: { label: t('main.todo.openSettings'), command: 'tab.openSettings', payload: { page: 'todo' } },
    }
  return { kind: 'error', text: t('main.todo.scanFailed'), sticky: true, action: view }
}

export function composeTodo(deps: ComposeTodoDeps): TodoService {
  const store = createTodoStore({ dir: deps.dir, logger: deps.logger })
  let previous: TodoScanResult | undefined
  let previousLoaded = false
  const scanner = createTodoScanner({
    substrate: deps.substrate,
    store,
    model: (selection) => deps.resolveModel(selection),
    config: deps.config,
    onProgress: (progress) => deps.broadcast('todo:progress', progress),
    onScanned: (result) => {
      deps.broadcast('todo:changed', { scope: 'all' })
      const toast = unattendedScanToast(result, previous)
      if (toast) deps.toast(toast)
      if (result.failure !== 'cancelled' && result.failure !== 'busy') previous = result
      previousLoaded = true
    },
    logger: deps.logger,
  })
  // The last result on disk seeds the "failed again" check, so a restart does not repeat the toast.
  void store
    .readState()
    .then((state) => {
      if (!previousLoaded) previous = state.last
      previousLoaded = true
    })
    .catch((e: unknown) => deps.logger('debug', 'todo: state not readable', { error: String(e) }))

  let active = false
  let lastKey = scheduleKey(deps.config())
  const unsubscribe = deps.onConfigChange(() => {
    const cfg = deps.config()
    const key = scheduleKey(cfg)
    if (key === lastKey) return
    lastKey = key
    if (!cfg.enabled || cfg.sources.length === 0) scanner.cancel()
    if (active) scanner.reschedule()
    deps.broadcast('todo:changed', { scope: 'status' })
  })

  return {
    store,
    scanner,
    start() {
      active = true
      scanner.start()
    },
    dispose() {
      active = false
      unsubscribe()
      scanner.stop()
    },
  }
}
