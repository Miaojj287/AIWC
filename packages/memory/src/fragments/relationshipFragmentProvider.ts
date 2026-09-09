/**
 * relationshipFragmentProvider — 'turn' tier. When the thread's origin peer has a clone profile,
 * inject a compact card (tone / traits / catchphrases / addressing / reply habits), the boundaries
 * and the 3 most recent samples. Bounded to 1200 tokens.
 *
 * Change detection: the kernel appends turn-tier fragments to history on EVERY turn, so without a
 * guard the same card would be re-recorded each turn. The provider remembers a digest of the last
 * card it handed out per (threadId, contactId) and returns [] while the profile is unchanged; a
 * re-clone, a correction or a new sample changes the digest and the card is injected again.
 */
import type { FragmentProvider, PersonaSample, RelationshipProfile, RelationshipStore, ThreadId } from '@aiwc/protocol'
import { createFragment, truncateToTokens } from '@aiwc/protocol'
import { sha256 } from '../internal/fsx'
import { truncateChars } from '../internal/text'

export const RELATIONSHIP_FRAGMENT_TOKEN_CAP = 1200
export const RELATIONSHIP_FRAGMENT_KIND = 'relationship_profile'
export const RELATIONSHIP_FRAGMENT_MARKER = '<relationship_profile>'
const RECENT_SAMPLES = 3

const list = (items: readonly string[], max: number) => items.slice(0, max).join('、')

export function recentSamples(samples: readonly PersonaSample[], n = RECENT_SAMPLES): PersonaSample[] {
  return samples
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.at ?? 0) - (a.s.at ?? 0) || b.i - a.i)
    .slice(0, n)
    .map((x) => x.s)
}

/** Render the card. Already bounded to RELATIONSHIP_FRAGMENT_TOKEN_CAP so direct callers stay safe too. */
export function renderRelationship(profile: RelationshipProfile): string {
  const { card, deep } = profile
  const who = profile.role === 'self' ? '用户本人' : profile.displayName
  const lines = [
    RELATIONSHIP_FRAGMENT_MARKER,
    `对象：${who}（${profile.contactId}）· 画像 v${profile.version}`,
    card.tone.length ? `语气：${list(card.tone, 6)}` : '',
    card.traits.length ? `性格：${list(card.traits, 8)}` : '',
    card.catchphrases.length ? `口头禅：${list(card.catchphrases, 10)}` : '',
    card.punctuation ? `标点习惯：${truncateChars(card.punctuation, 80)}` : '',
    card.addressing.self || card.addressing.other ? `称呼：自称「${card.addressing.self ?? '—'}」，称对方「${card.addressing.other ?? '—'}」` : '',
    card.topics.length ? `常聊：${list(card.topics, 8)}` : '',
  ]
  const habits = Object.entries(card.replyHabits).slice(0, 6)
  if (habits.length) lines.push('回复习惯：' + habits.map(([k, v]) => `${k}→${truncateChars(v, 40)}`).join('；'))
  if (deep.relationship) lines.push(`关系：${truncateChars(deep.relationship, 120)}`)
  if (deep.boundaries.length) lines.push('边界（不要触碰）：' + deep.boundaries.slice(0, 8).map((b) => truncateChars(b, 60)).join('；'))
  const samples = recentSamples(profile.samples)
  if (samples.length) {
    lines.push('最近样本：')
    for (const s of samples) lines.push(`- 对方：${truncateChars(s.prompt.replace(/\s+/g, ' '), 80)}\n  回：${truncateChars(s.reply.replace(/\s+/g, ' '), 120)}${s.corrected ? '（用户修正）' : ''}`)
  }
  lines.push('</relationship_profile>')
  return truncateToTokens(lines.filter(Boolean).join('\n'), RELATIONSHIP_FRAGMENT_TOKEN_CAP)
}

export interface RelationshipFragmentProvider extends FragmentProvider {
  tier: 'turn'
  /** Forget what was injected — for one thread, or for every thread when omitted (tests; after a history rewrite). */
  reset(threadId?: ThreadId): void
}

const seenKey = (threadId: ThreadId, contactId: string) => `${threadId} ${contactId}`

export function relationshipFragmentProvider(store: RelationshipStore): RelationshipFragmentProvider {
  /** (threadId, contactId) → sha256 of the card text last handed to the kernel for that thread */
  const seen = new Map<string, string>()
  return {
    tier: 'turn',
    async provide(ctx) {
      const peerId = ctx.origin.peerId
      if (!peerId) return []
      const profile = await store.get(peerId)
      if (!profile) return []
      const text = renderRelationship(profile)
      const key = seenKey(ctx.threadId, peerId)
      const digest = sha256(text)
      if (seen.get(key) === digest) return []
      seen.set(key, digest)
      return [createFragment(RELATIONSHIP_FRAGMENT_KIND, RELATIONSHIP_FRAGMENT_MARKER, RELATIONSHIP_FRAGMENT_TOKEN_CAP, () => text)]
    },
    reset(threadId) {
      if (threadId === undefined) {
        seen.clear()
        return
      }
      const prefix = `${threadId} `
      for (const k of [...seen.keys()]) if (k.startsWith(prefix)) seen.delete(k)
    },
  }
}
