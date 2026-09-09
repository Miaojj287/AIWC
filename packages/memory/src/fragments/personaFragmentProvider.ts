/**
 * personaFragmentProvider — the context a 克隆 thread runs on. Only threads whose profile is
 * 'persona' get anything; every other thread sees an empty list, so registering this provider is
 * free for the normal agent.
 *
 * Three fragments, deliberately on different tiers:
 *  - `<persona>`        stable: identity + style card + deep profile + static samples + chat rules.
 *                       Frozen for the thread, so the provider prompt cache holds for the session.
 *  - `<persona_notes>`  turn, digest-deduped: the corrections the user gave ("TA 不会这么说") and the
 *                       episode summaries. Re-injected only when they actually change.
 *  - `<persona_recall>` turn: what THIS message reminds the person of — real replies they gave to
 *                       similar messages, plus real chat excerpts. Rebuilt every turn.
 *
 * Everything here degrades to silence: no pairs, no search backend, a failing store — the thread
 * still runs on the stable identity block.
 */
import type { ContextFragment, FragmentProvider, FragmentProviderContext, PersonaNote, PersonaPair, RelationshipProfile, RelationshipStore, SubstrateService, ThreadId } from '@aiwc/protocol'
import { createFragment } from '@aiwc/protocol'
import { PERSONA_IDENTITY_MARKER, PERSONA_IDENTITY_TOKEN_CAP, PERSONA_TURN_MARKER, PERSONA_TURN_TOKEN_CAP, renderPersonaIdentity, renderPersonaTurn } from '../clone/personaPrompt'
import { PAIR_TOP_K, searchPairs } from '../clone/pairs'
import { sha256 } from '../internal/fsx'

export const PERSONA_IDENTITY_KIND = 'persona'
export const PERSONA_NOTES_KIND = 'persona_notes'
export const PERSONA_RECALL_KIND = 'persona_recall'
export const PERSONA_NOTES_MARKER = '<persona_notes>'
export const PERSONA_NOTES_TOKEN_CAP = 1200

const MEMORY_TOP_K = 4
const RECALL_PAIRS = 4
/** How many recent user turns are joined into the retrieval query (「那你觉得呢」 alone retrieves noise). */
const CONTEXT_TURNS = 3
const CONTEXT_CHARS = 300

export interface PersonaFragmentDeps {
  relationships: RelationshipStore
  /** Optional: enables recall of real chat excerpts from the session. */
  substrate?: SubstrateService
  logger?: (level: 'debug' | 'warn', msg: string, meta?: unknown) => void
}

export interface PersonaFragmentProvider extends FragmentProvider {
  tier: 'turn'
  /** Forget per-thread state (recent-turn buffer, notes digest). */
  reset(threadId?: ThreadId): void
}

/** The stable half; separate object because the kernel groups providers by tier. */
export interface PersonaIdentityProvider extends FragmentProvider {
  tier: 'stable'
}

const isPersona = (ctx: FragmentProviderContext) => ctx.settings.profile === 'persona'

async function loadProfile(store: RelationshipStore, ctx: FragmentProviderContext): Promise<RelationshipProfile | undefined> {
  const peerId = ctx.origin.peerId
  if (!peerId) return undefined
  return store.get(peerId)
}

/** Stable tier: who the clone is. Registered alongside the turn provider below. */
export function personaIdentityProvider(deps: PersonaFragmentDeps): PersonaIdentityProvider {
  return {
    tier: 'stable',
    async provide(ctx) {
      if (!isPersona(ctx)) return []
      const profile = await loadProfile(deps.relationships, ctx)
      if (!profile) return []
      const text = renderPersonaIdentity(profile)
      return [createFragment(PERSONA_IDENTITY_KIND, PERSONA_IDENTITY_MARKER, PERSONA_IDENTITY_TOKEN_CAP, () => text)]
    },
  }
}

export function personaFragmentProvider(deps: PersonaFragmentDeps): PersonaFragmentProvider {
  /** threadId → the last few user turns, newest last */
  const recent = new Map<string, string[]>()
  /** threadId → sha of the notes block last injected */
  const notesDigest = new Map<string, string>()

  const contextQuery = (threadId: ThreadId, userText: string): string => {
    const key = String(threadId)
    const buf = recent.get(key) ?? []
    const next = [...buf, userText].filter(Boolean).slice(-CONTEXT_TURNS)
    recent.set(key, next)
    return next.join('\n').slice(-CONTEXT_CHARS)
  }

  const pairsFor = async (contactId: string, query: string, ctxQuery: string): Promise<PersonaPair[]> => {
    if (!deps.relationships.listPairs) return []
    try {
      const all = await deps.relationships.listPairs(contactId)
      return searchPairs(all, query, { limit: Math.min(RECALL_PAIRS, PAIR_TOP_K), contextQuery: ctxQuery })
    } catch (e) {
      deps.logger?.('warn', 'persona: pair lookup failed', e)
      return []
    }
  }

  const memoriesFor = async (contactId: string, query: string, role: RelationshipProfile['role']): Promise<string[]> => {
    if (!deps.substrate || !query.trim()) return []
    // 'you' is the person being played: the contact normally, the user themself for a self-clone
    const speaker = (isSelf: boolean) => (isSelf === (role === 'self') ? '你' : '对方')
    try {
      const hits = await deps.substrate.search({ query, sessionIds: [contactId], limit: MEMORY_TOP_K, mode: 'hybrid' })
      return hits.map((h) => `${speaker(h.message.isSelf)}: ${h.snippet || h.message.text}`.replace(/\s+/g, ' ').trim()).filter(Boolean)
    } catch (e) {
      deps.logger?.('warn', 'persona: recall failed', e)
      return []
    }
  }

  const notesFor = async (contactId: string): Promise<PersonaNote[]> => {
    if (!deps.relationships.listNotes) return []
    try {
      return await deps.relationships.listNotes(contactId)
    } catch (e) {
      deps.logger?.('warn', 'persona: notes read failed', e)
      return []
    }
  }

  return {
    tier: 'turn',
    async provide(ctx) {
      if (!isPersona(ctx)) return []
      const contactId = ctx.origin.peerId
      if (!contactId) return []
      const profile = await loadProfile(deps.relationships, ctx)
      if (!profile) return []

      const query = ctx.userText.trim()
      const ctxQuery = contextQuery(ctx.threadId, query)
      const [pairs, memories, notes] = await Promise.all([pairsFor(contactId, query, ctxQuery), memoriesFor(contactId, query, profile.role), notesFor(contactId)])

      const out: ContextFragment[] = []

      // notes change rarely: inject once, then only when the user adds a correction
      const notesText = renderPersonaTurn({ notes }, PERSONA_NOTES_MARKER)
      if (notesText) {
        const key = `${ctx.threadId} ${contactId}`
        const digest = sha256(notesText)
        if (notesDigest.get(key) !== digest) {
          notesDigest.set(key, digest)
          out.push(createFragment(PERSONA_NOTES_KIND, PERSONA_NOTES_MARKER, PERSONA_NOTES_TOKEN_CAP, () => notesText))
        }
      }

      const knownPrompts = new Set(profile.samples.map((s) => s.prompt).filter(Boolean))
      const recallText = renderPersonaTurn({ pairs, memories, knownPrompts })
      if (recallText) out.push(createFragment(PERSONA_RECALL_KIND, PERSONA_TURN_MARKER, PERSONA_TURN_TOKEN_CAP, () => recallText))
      return out
    },
    reset(threadId) {
      if (threadId === undefined) {
        recent.clear()
        notesDigest.clear()
        return
      }
      const key = String(threadId)
      recent.delete(key)
      for (const k of [...notesDigest.keys()]) if (k.startsWith(`${key} `)) notesDigest.delete(k)
    },
  }
}
