/**
 * Sync engine: pulls sessions / contacts / messages from a SourceReader into the Mirror.
 *  - per session: messagesAfter(watermark) in pages until exhausted → insertMessages → watermark
 *  - full sync starts every session from seq 0 (dedupe makes it idempotent)
 *  - concurrent requests coalesce: a run in flight is shared, later requests queue one follow-up
 *  - schedule() debounces source.watch() notifications into an incremental run
 */
import type { SubstrateEvent, SyncStatus, WxSession } from '@aiwc/protocol'
import type { SourceReader } from '../source'
import type { Mirror } from '../mirror/types'
import { sessionKindFromUsername } from '../normalize/kinds'
import { errorMessage } from '../shared/errors'
import { debounce, type Debounced } from '../shared/async'
import { nowMs } from '../shared/time'

export interface SyncEngineDeps {
  source: SourceReader
  mirror: Mirror
  emit: (event: SubstrateEvent) => void
  /** messages per source page (default 500) */
  pageSize?: number
  /** debounce for watch-triggered incremental syncs (default 100ms) */
  watchDebounceMs?: number
  /** min interval between progress events (default 120ms) */
  progressIntervalMs?: number
}

export interface SyncRunOptions {
  full?: boolean
  /** Restrict to these sessions (incremental). Undefined = all sessions. */
  sessionIds?: string[]
}

export interface SyncEngine {
  readonly status: SyncStatus
  readonly running: boolean
  run(opts?: SyncRunOptions): Promise<SyncStatus>
  schedule(sessionIds?: string[]): void
  cancel(): void
  /** cancel + drop any scheduled work */
  stop(): void
}

function mergeOptions(a: SyncRunOptions | undefined, b: SyncRunOptions): SyncRunOptions {
  if (!a) return { ...b }
  const full = Boolean(a.full || b.full)
  if (!a.sessionIds || !b.sessionIds) return { full }
  return { full, sessionIds: [...new Set([...a.sessionIds, ...b.sessionIds])] }
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const pageSize = Math.max(1, Math.floor(deps.pageSize ?? 500))
  const progressInterval = deps.progressIntervalMs ?? 120
  let status: SyncStatus = { phase: 'idle' }
  let running: Promise<SyncStatus> | undefined
  let queued: SyncRunOptions | undefined
  let cancelled = false
  let stopped = false

  const setStatus = (next: SyncStatus) => {
    status = next
    deps.emit({ type: 'sync', status })
  }

  const totals = (): NonNullable<SyncStatus['totals']> => {
    const overview = deps.mirror.stats({ metric: 'overview' })
    const media = overview.rows.find((r) => r.key === 'media')?.value
    return {
      sessions: deps.mirror.listSessions({ limit: 1, includeHidden: true }).total,
      messages: deps.mirror.countMessages(),
      media: typeof media === 'number' ? media : 0,
    }
  }

  const syncSession = async (s: WxSession, full: boolean): Promise<boolean> => {
    if (s.kind === 'group' && (full || !deps.mirror.hasGroupMembers(s.id))) {
      try {
        const members = await deps.source.groupMembers(s.id)
        deps.mirror.upsertGroupMembers(
          s.id,
          members.map((c) => ({ username: c.username, displayName: c.remark || c.nickname || undefined })),
        )
      } catch {
        /* members are best-effort */
      }
    }
    let from = full ? 0 : deps.mirror.watermark(s.id)
    let changed = false
    for (;;) {
      if (cancelled) break
      const page = await deps.source.messagesAfter(s.id, from, pageSize)
      const last = page[page.length - 1]
      if (!last) break
      const r = deps.mirror.insertMessages(page)
      if (r.inserted > 0) {
        changed = true
        deps.emit({ type: 'messages.changed', sessionIds: [s.id] })
      }
      from = Math.max(from, last.seq)
      deps.mirror.setWatermark(s.id, from, last.createdAt)
      if (page.length < pageSize) break
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return changed
  }

  const execute = async (opts: SyncRunOptions): Promise<SyncStatus> => {
    cancelled = false
    const startedAt = nowMs()
    setStatus({ ...status, phase: 'syncing', error: undefined, progress: { done: 0, total: 0, label: '读取会话列表' } })
    try {
      let publishedPage = false
      const raw = await deps.source.sessions((page) => {
        if (cancelled || page.length === 0) return
        const ready = page.map((s) => ({ ...s, kind: s.kind ?? sessionKindFromUsername(s.id), title: s.title || s.id }))
        deps.mirror.upsertSessions(ready)
        publishedPage = true
        deps.emit({ type: 'sessions.changed' })
      })
      const sessions: WxSession[] = raw.map((s) => ({ ...s, kind: s.kind ?? sessionKindFromUsername(s.id), title: s.title || s.id }))
      deps.mirror.upsertSessions(sessions)
      if (!publishedPage) deps.emit({ type: 'sessions.changed' })

      if (!opts.sessionIds || opts.full) {
        setStatus({ ...status, progress: { done: 0, total: sessions.length, label: '读取联系人' } })
        const contacts = await deps.source.contacts()
        deps.mirror.upsertContacts(contacts)
      }

      let targets = sessions
      if (opts.sessionIds) {
        const wanted = new Set(opts.sessionIds)
        targets = sessions.filter((s) => wanted.has(s.id))

      }

      const total = targets.length
      const errors: string[] = []
      let lastProgressAt = 0
      for (let i = 0; i < targets.length; i++) {
        if (cancelled) break
        const s = targets[i]!
        const now = nowMs()
        if (now - lastProgressAt >= progressInterval || i === 0) {
          lastProgressAt = now
          setStatus({ ...status, progress: { done: i, total, label: s.title } })
        }
        try {
          await syncSession(s, Boolean(opts.full))
        } catch (err) {
          errors.push(`${s.title}: ${errorMessage(err)}`)
        }
      }

      const done: SyncStatus = {
        phase: cancelled ? 'idle' : errors.length ? 'error' : 'idle',
        lastSyncedAt: startedAt,
        progress: { done: total, total, label: cancelled ? '已取消' : '完成' },
        totals: totals(),
      }
      if (errors.length) done.error = errors.length === 1 ? errors[0] : `${errors[0]}（另有 ${errors.length - 1} 个会话失败）`
      setStatus(done)
      return done
    } catch (err) {
      const failed: SyncStatus = { phase: 'error', lastSyncedAt: status.lastSyncedAt, error: errorMessage(err), totals: safeTotals() }
      setStatus(failed)
      return failed
    }
  }

  const safeTotals = (): SyncStatus['totals'] => {
    try {
      return totals()
    } catch {
      return status.totals
    }
  }

  const run = (opts: SyncRunOptions = {}): Promise<SyncStatus> => {
    if (stopped) return Promise.resolve(status)
    if (running) {
      queued = mergeOptions(queued, opts)
      return running
    }
    running = execute(opts).finally(() => {
      running = undefined
      if (queued && !stopped) {
        const next = queued
        queued = undefined
        void run(next)
      }
    })
    return running
  }

  const scheduled: Debounced<[string[] | undefined]> = debounce<[string[] | undefined], { ids?: string[]; all: boolean }>(
    deps.watchDebounceMs ?? 100,
    (state, ids) => {
      if (!ids || state?.all) return { all: true }
      return { all: false, ids: [...new Set([...(state?.ids ?? []), ...ids])] }
    },
    (state) => {
      if (stopped) return
      void run(state.all ? {} : { sessionIds: state.ids ?? [] }).catch(() => {})
    },
  )

  return {
    get status() {
      return status
    },
    get running() {
      return running !== undefined
    },
    run,
    schedule: (ids) => {
      if (!stopped) scheduled(ids)
    },
    cancel: () => {
      cancelled = true
      queued = undefined
    },
    stop: () => {
      stopped = true
      cancelled = true
      queued = undefined
      scheduled.cancel()
    },
  }
}
