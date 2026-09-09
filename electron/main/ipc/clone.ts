import type { CloneStatus, HistoryItem, PersonaNote, RelationshipProfile, WxMessage } from '@aiwc/protocol'
import { MAX_TRANSCRIPT_CHARS, reflectConversation, renderTranscript } from '@aiwc/memory'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

/**
 * Contacts offered for cloning. The list is filtered and searched in the renderer, so this bound has
 * to comfortably cover a real account's DM count (~1k on the accounts we tested) — a tighter cap
 * would drop contacts from the picker with nothing on screen saying so.
 */
const CONTACT_LIMIT = 2000
const SAMPLE_DEFAULT = 50
const SAMPLE_MAX = 500
/** Below this many transcript messages there is nothing worth distilling. */
const REFLECT_MIN_MESSAGES = 6
/** …and it is only redone once the transcript grew by this much since the last run. */
const REFLECT_MIN_GROWTH = 6

export function registerCloneIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { relationships, substrate, clone, kernel, models } = ctx

  const requireProfile = async (contactId: string): Promise<RelationshipProfile> => {
    const p = await relationships.get(contactId)
    if (!p) throw new Error('该联系人尚未克隆')
    return p
  }

  /**
   * Every DM contact the substrate knows about, merged with the clone status of the ones that have a
   * relationship folder. Listing only cloned contacts (the relationship store's own view) left the
   * 克隆 column empty on a fresh install, with no way to start a first clone from the UI.
   */
  handle('clone:list', async () => {
    const cloned = await relationships.list()
    const byId = new Map(cloned.map((c) => [c.contactId, c]))
    const rows = new Map<string, { contactId: string; displayName: string; status: CloneStatus; messageCount?: number; lastContactAt?: number; avatarPath?: string }>()

    try {
      const page = await substrate.listSessions({ kind: 'dm', limit: CONTACT_LIMIT, offset: 0 })
      for (const s of page.items) {
        const known = byId.get(s.id)
        rows.set(s.id, {
          contactId: s.id,
          displayName: known?.displayName || s.title,
          status: known?.status ?? { state: 'none', messageCount: s.indexedCount ?? 0 },
          messageCount: s.indexedCount,
          lastContactAt: s.lastMessageAt,
          avatarPath: s.avatarPath,
        })
      }
    } catch {
      // substrate not connected yet: fall through to the cloned-only view rather than failing the call
    }

    // Clones whose session is gone (or beyond the page) must never disappear from the list.
    for (const c of cloned) {
      if (rows.has(c.contactId)) continue
      let lastContactAt: number | undefined
      let messageCount: number | undefined
      let avatarPath: string | undefined
      try {
        const s = await substrate.getSession(c.contactId)
        lastContactAt = s?.lastMessageAt
        messageCount = s?.indexedCount
        avatarPath = s?.avatarPath
      } catch {
        // keep the row, just without substrate metadata
      }
      rows.set(c.contactId, { ...c, lastContactAt, avatarPath, messageCount: messageCount ?? (c.status.state === 'none' ? c.status.messageCount : undefined) })
    }

    return [...rows.values()]
  })

  handle('clone:get', ({ contactId }) => relationships.get(contactId))

  /**
   * The relationship store knows nothing about WeChat, so the `none` status it derives carries
   * messageCount 0. Fill it in from the session index — this number is what the confirm page shows
   * and what the 「至少 300 条」 warning is judged against, so a hardcoded 0 made both wrong for every
   * contact (clone:list already merges it in; this is the same fix for the single-contact read).
   */
  handle('clone:status', async ({ contactId }) => {
    const status = await relationships.status(contactId)
    if (status.state !== 'none') return status
    try {
      const s = await substrate.getSession(contactId)
      if (s?.indexedCount) return { ...status, messageCount: s.indexedCount }
    } catch {
      // substrate not ready: leave 0, the confirm page falls back to its own overview query
    }
    return status
  })

  handle('clone:sampleMessages', async ({ contactId, limit }) => {
    const n = Math.min(SAMPLE_MAX, Math.max(1, limit ?? SAMPLE_DEFAULT))
    const page = await substrate.listMessages({ sessionId: contactId, limit: n, kinds: ['text', 'quote'] })
    return page.items.filter((m: WxMessage) => !m.isSelf).slice(-n)
  })

  handle('clone:start', ({ contactId, range, model, keepCorrections }) => clone.start(contactId, { range, model, keepCorrections }))
  handle('clone:cancel', ({ contactId }) => clone.cancel(contactId))

  handle('clone:delete', async ({ contactId }) => {
    clone.cancel(contactId)
    await relationships.remove(contactId)
    ctx.toast({ kind: 'success', text: '已删除克隆' })
    return { affectedRules: [] }
  })

  handle('clone:updateProfile', async ({ contactId, patch }) => {
    const p = await requireProfile(contactId)
    const now = Date.now()
    const corrections = [...p.corrections]
    for (const field of ['card', 'deep', 'samples'] as const) {
      if (patch[field] !== undefined) corrections.push({ at: now, field, from: JSON.stringify(p[field]).slice(0, 2000), to: JSON.stringify(patch[field]).slice(0, 2000) })
    }
    const next: RelationshipProfile = {
      ...p,
      card: patch.card ? { ...p.card, ...patch.card } : p.card,
      deep: patch.deep ? { ...p.deep, ...patch.deep } : p.deep,
      samples: patch.samples ?? p.samples,
      corrections,
      updatedAt: now,
    }
    await relationships.upsert(next)
    return next
  })

  handle('clone:chat', async ({ contactId, threadId, text }) => {
    const p = await requireProfile(contactId)
    const id = await kernel.ensureThread(
      { channel: 'desktop', chatId: contactId, peerId: contactId },
      { profile: 'persona', permissionMode: 'ask', title: `与 ${p.displayName} 的分身对话` },
      threadId,
    )
    await kernel.submit({
      type: 'turn.start',
      threadId: id,
      input: { content: [{ type: 'text', text }], mentions: [{ kind: 'contact', id: contactId, label: p.displayName }] },
    })
  })

  /**
   * 「不像 TA」 with a correction is the most valuable signal the user can give, so it becomes a note
   * the persona prompt must obey from the next turn on — not only an audit row. The raw verdict is
   * still appended to corrections.jsonl so a re-clone can see what was disliked.
   */
  handle('clone:feedback', async ({ contactId, messageItemId, verdict, correction, saveAsSample }) => {
    const p = await requireProfile(contactId)
    const now = Date.now()
    const next: RelationshipProfile = { ...p, updatedAt: now, corrections: [...p.corrections, { at: now, field: `feedback:${messageItemId}`, from: verdict, to: correction ?? '' }] }
    if (saveAsSample && correction) {
      next.samples = [...p.samples, { prompt: '', reply: correction, at: now, corrected: true }]
    }
    await relationships.upsert(next)
    const text = correction?.trim()
    if (verdict === 'not_like' && text) {
      await relationships.addNotes(contactId, [{ kind: 'correction', text: `对方指出上一条不像${p.displayName}，并说明：${text}` }], now)
    }
  })

  handle('clone:notes', ({ contactId }) => relationships.listNotes(contactId))
  handle('clone:deleteNote', ({ contactId, at }) => relationships.removeNote(contactId, at))

  /**
   * Distil the test chat into corrections + an episode summary. Called by the UI when a conversation
   * has gone on for a while; cheap to call repeatedly because the reflected watermark short-circuits it.
   */
  handle('clone:reflect', async ({ contactId, threadId }) => {
    const p = await requireProfile(contactId)
    const thread = await kernel.getThread(threadId)
    if (!thread) return { ok: false, corrections: 0 }
    const messages = transcriptOf(thread.items)
    const seen = await relationships.getReflected(contactId, String(threadId))
    if (messages.length < REFLECT_MIN_MESSAGES || messages.length - seen < REFLECT_MIN_GROWTH) return { ok: false, corrections: 0 }

    const transcript = renderTranscript(messages.slice(seen), p.displayName).slice(-MAX_TRANSCRIPT_CHARS)
    if (!transcript.trim()) return { ok: false, corrections: 0 }
    let notes: Array<Omit<PersonaNote, 'at'>>
    try {
      notes = await reflectConversation(await models.resolveAuxiliary(), { displayName: p.displayName, transcript })
    } catch (e) {
      ctx.logger.child('clone').warn('reflection failed', e)
      return { ok: false, corrections: 0 }
    }
    // Mark as reflected either way: a run that found nothing should not be retried on every message.
    await relationships.setReflected(contactId, String(threadId), messages.length)
    if (notes.length > 0) await relationships.addNotes(contactId, notes)
    return { ok: true, corrections: notes.filter((n) => n.kind === 'correction').length, episode: notes.find((n) => n.kind === 'episode')?.text }
  })
}

function transcriptOf(items: readonly HistoryItem[]): Array<{ role: 'user' | 'assistant'; text: string }> {
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const it of items) {
    if (it.type === 'user_message') {
      const text = it.content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .filter(Boolean)
        .join('\n')
      if (text.trim()) out.push({ role: 'user', text })
    } else if (it.type === 'assistant_message' && it.text.trim()) {
      out.push({ role: 'assistant', text: it.text })
    }
  }
  return out
}
