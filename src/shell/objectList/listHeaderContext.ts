/**
 * The ObjectList frame owns the header (search, segment chips, extra filters); each list body owns
 * the data. This tiny context lets the body push live segment counts and its extra filter options
 * up into the frame (DESIGN-SPEC §1.1: chips carry real-time counts; 更多筛选 lists 仅未读 / 已静音 …).
 *
 *   const counts = useMemo(() => ({ all, dm, group }), [...])
 *   useListCounts(counts)
 *   useListFilterOptions(SESSION_FILTER_OPTIONS)
 */
import { createContext, useContext, useEffect, useRef } from 'react'

export interface ListFilterOption {
  /** Key stored in shellStore.listFilters. */
  id: string
  label: string
  description?: string
}

export interface ListHeaderApi {
  setCounts(counts: Record<string, number>): void
  setFilterOptions(options: readonly ListFilterOption[]): void
}

const noop = () => {}

export const ListHeaderContext = createContext<ListHeaderApi>({ setCounts: noop, setFilterOptions: noop })

export function useListHeader(): ListHeaderApi {
  return useContext(ListHeaderContext)
}

/** Publish segment counts; re-sent only when a value actually changes. */
export function useListCounts(counts: Record<string, number> | undefined): void {
  const { setCounts } = useListHeader()
  const key = counts ? JSON.stringify(counts) : ''
  const latest = useRef(counts)
  latest.current = counts
  useEffect(() => {
    if (latest.current) setCounts(latest.current)
  }, [key, setCounts])
}

/** Publish the body's extra filter options for the header's 更多筛选 dropdown; cleared on unmount. */
export function useListFilterOptions(options: readonly ListFilterOption[]): void {
  const { setFilterOptions } = useListHeader()
  useEffect(() => {
    setFilterOptions(options)
    return () => setFilterOptions([])
  }, [options, setFilterOptions])
}
