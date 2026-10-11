/**
 * Names and avatars of the chats the search tab shows (picked chats, chats with hits): substrate:getSession once per
 * id, kept for the tab's life. Live search adds a few chats per keystroke, so ids already asked for are never asked
 * again — unlike useSessionsById (src/platform/sessionPaging.ts), which refetches the whole set whenever it changes
 * and cannot tell "still loading" from "not found".
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WxSession } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'

export interface ChatLookup {
  /** The chat, `null` when it was not found (or the lookup failed), `undefined` while it is being looked up. */
  chat(id: string): WxSession | null | undefined
}

export function useChats(ids: readonly string[], enabled: boolean): ChatLookup {
  const key = [...new Set(ids)].sort().join('\n')
  const asked = useRef(new Set<string>())
  const [found, setFound] = useState<ReadonlyMap<string, WxSession | null>>(() => new Map())

  useEffect(() => {
    if (!enabled || !key) return
    const fresh = key.split('\n').filter((id) => !asked.current.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) asked.current.add(id)
    // Per-id facts, not per-search answers: a reply that lands after the search moved on is still worth keeping.
    void Promise.all(
      fresh.map((id) =>
        invoke('substrate:getSession', { id }).then(
          (session) => [id, session ?? null] as const,
          () => [id, null] as const,
        ),
      ),
    ).then((pairs) =>
      setFound((prev) => {
        const next = new Map(prev)
        for (const [id, session] of pairs) next.set(id, session)
        return next
      }),
    )
  }, [enabled, key])

  const chat = useCallback((id: string) => found.get(id), [found])
  return { chat }
}
