/**
 * Resolves a citation (sessionId + messageId) to the real message and its chat once per app
 * lifetime: a reply may cite the same message several times and every chip would otherwise hit
 * the substrate again. A failed lookup is dropped from the cache so the next mount retries.
 */
import type { WxMessage, WxSession } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'
import type { CitationRef } from './citations'

export interface ResolvedCitation {
  message: WxMessage | undefined
  session: WxSession | undefined
}

const messages = new Map<string, Promise<WxMessage | undefined>>()
const sessions = new Map<string, Promise<WxSession | undefined>>()

function remember<V>(map: Map<string, Promise<V>>, key: string, load: () => Promise<V>): Promise<V> {
  const cached = map.get(key)
  if (cached) return cached
  const job = load()
  map.set(key, job)
  job.catch(() => {
    if (map.get(key) === job) map.delete(key)
  })
  return job
}

export function resolveCitation(ref: CitationRef): Promise<ResolvedCitation> {
  const message = remember(messages, `${ref.sessionId}|${ref.messageId}`, () =>
    invoke('substrate:getMessage', { sessionId: ref.sessionId, messageId: ref.messageId }),
  )
  const session = remember(sessions, ref.sessionId, () => invoke('substrate:getSession', { id: ref.sessionId }))
  return Promise.all([message, session]).then(([m, s]) => ({ message: m, session: s }))
}

/** Tests only. */
export function __resetCitationCacheForTests(): void {
  messages.clear()
  sessions.clear()
}
