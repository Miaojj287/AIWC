/**
 * The Agent tabs a restart brings back (panel strip and Agent window alike): which saved threads were open and which
 * one was in front. A per-device convenience, so it lives in localStorage (like the boot theme, platform/themeBoot.ts);
 * unreadable or missing storage simply means "start like a fresh install". Local drafts that never reached the kernel
 * are not saved — there is nothing to reopen.
 */
import type { StoreApi } from 'zustand'
import type { ThreadId } from '@aiwc/protocol'
import type { AgentState } from './agentStore'

const STORAGE_KEY = 'aiwc.agent.openThreads.v1'
/** More tabs than this are not worth restoring (and bound what a corrupted entry can make us load). */
export const MAX_RESTORED_TABS = 12

export interface SavedTabs {
  openIds: ThreadId[]
  activeThreadId: ThreadId | null
}

const isId = (v: unknown): v is ThreadId => typeof v === 'string' && v.length > 0 && v.length <= 128

export function readSavedTabs(): SavedTabs | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { openIds?: unknown; activeThreadId?: unknown }
    const openIds = Array.isArray(parsed.openIds) ? parsed.openIds.filter(isId).slice(0, MAX_RESTORED_TABS) : []
    const active = isId(parsed.activeThreadId) && openIds.includes(parsed.activeThreadId) ? parsed.activeThreadId : null
    return { openIds, activeThreadId: active ?? openIds[0] ?? null }
  } catch {
    // unreadable storage or a corrupted entry: start without restored tabs
    return undefined
  }
}

export function writeSavedTabs(tabs: SavedTabs): void {
  try {
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ openIds: tabs.openIds.slice(0, MAX_RESTORED_TABS), activeThreadId: tabs.activeThreadId }),
    )
  } catch {
    // storage full or blocked: the tabs simply will not come back after a restart
  }
}

export function clearSavedTabs(): void {
  stopWatchingOpenTabs()
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // nothing to clear
  }
}

/** What to save for the current strip: saved threads only, the front one when it is among them. */
export function tabsToSave(
  openIds: readonly ThreadId[],
  activeThreadId: ThreadId | null,
  localIds: readonly ThreadId[],
): SavedTabs {
  const kept = openIds.filter((id) => !localIds.includes(id))
  return { openIds: kept, activeThreadId: activeThreadId && kept.includes(activeThreadId) ? activeThreadId : null }
}

let watching: (() => void) | undefined

/** Keep the saved tabs in step with the strip from now on (installed once, after the first hydrate). */
export function watchOpenTabs(store: StoreApi<AgentState>): void {
  if (watching) return
  let last = ''
  watching = store.subscribe((s) => {
    const next = tabsToSave(s.openIds, s.activeThreadId, s.localIds)
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    writeSavedTabs(next)
  })
}

/** Stop watching (tests reset the store between cases). */
export function stopWatchingOpenTabs(): void {
  watching?.()
  watching = undefined
}

/**
 * Restored tabs whose thread was not on the first history page: load each, and drop the ones that no longer exist
 * (deleted since) so no invisible tab is left behind.
 */
export async function settleRestoredTabs(store: StoreApi<AgentState>, ids: readonly ThreadId[]): Promise<void> {
  await Promise.all(ids.map((id) => store.getState().loadThread(id)))
  const known = new Set(store.getState().threads.map((x) => x.threadId))
  const gone = ids.filter((id) => !known.has(id))
  if (!gone.length) return
  store.setState((s) => {
    const openIds = s.openIds.filter((id) => !gone.includes(id))
    const views = { ...s.views }
    for (const id of gone) delete views[id]
    const activeThreadId = s.activeThreadId && gone.includes(s.activeThreadId) ? (openIds[0] ?? null) : s.activeThreadId
    return { openIds, activeThreadId, views }
  })
}
