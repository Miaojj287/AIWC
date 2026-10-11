/**
 * 最近搜索 — a per-viewer convenience list in this window's localStorage (losing it costs nothing, so it is not
 * config). Every read and write is guarded: a private window, a test or a full disk simply starts from an empty list.
 * Searches are remembered when they are submitted (Enter, a request from another surface) or a hit is opened.
 */
import { create } from 'zustand'
import { parseRecent, pushRecent } from './searchModel'

const STORAGE_KEY = 'aiwc.search.recent'

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseRecent(JSON.parse(raw)) : []
  } catch {
    // Storage unavailable or a corrupt entry: start from an empty list.
    return []
  }
}

function persist(items: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage unavailable: the list lives for this session only.
  }
}

interface RecentSearchesState {
  items: string[]
}

export const useRecentSearches = create<RecentSearchesState>(() => ({ items: load() }))

function replace(items: string[]): void {
  persist(items)
  useRecentSearches.setState({ items })
}

export function rememberSearch(query: string): void {
  replace(pushRecent(useRecentSearches.getState().items, query))
}

export function forgetSearch(query: string): void {
  replace(useRecentSearches.getState().items.filter((item) => item !== query))
}

/** Empty the list and return what it held (for 撤销). */
export function clearRecentSearches(): string[] {
  const previous = useRecentSearches.getState().items
  replace([])
  return previous
}

export function restoreRecentSearches(items: readonly string[]): void {
  replace(parseRecent(items))
}

/** Tests: re-read the list from storage. */
export function __resetRecentSearchesForTests(): void {
  useRecentSearches.setState({ items: load() })
}
