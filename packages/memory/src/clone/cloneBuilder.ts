/**
 * createCloneBuilder — build a RelationshipProfile for one contact from their chat history.
 *
 *   读取聊天记录 → 补转语音 → (≥ 300 messages unless force；私聊不足时补群聊发言)
 *   → 提炼说话风格与深层画像（chunks, concurrency 3） → 合并画像
 *   → 生成样本对话与检索语料（真实问答对） → 写入本地画像 · 不上传
 *
 * Status flows through onStatus() and, when the store supports it, is persisted so the contact list
 * survives restarts. cancel() aborts the in-flight build and restores the previous status.
 */
import type { CloneStatus, Millis, ModelClient, ModelSelection, PersonaCard, PersonaDeep, PersonaPair, PersonaSample, PersonaStats, RelationshipProfile, RelationshipStore, SubstrateService, WxMessage } from '@aiwc/protocol'
import { mapConcurrent } from '../internal/model'
import { applyCorrections } from './corrections'
import { MAX_MESSAGES, MIN_MESSAGES, PROFILE_MAX_CHUNKS, computeStats, extractPairs, loadContactMessages, mergeTurns, pickSamples, renderChunks, selectChunks } from './corpus'
import { collectGroupCorpus, EMPTY_GROUP_CORPUS, type GroupCorpus } from './groupCorpus'
import { extractChunk, mergeLocally, mergeParts, toCardAndDeep, type CloneNames, type PersonaPartial } from './llm'

export interface CloneBuildOptions {
  range?: { from?: Millis; to?: Millis }
  /** Model for this build; handed to deps.model(selection). */
  model?: ModelSelection
  /** re-apply corrections.jsonl onto the new profile (default true); false clears them */
  keepCorrections?: boolean
  /** build even when fewer than MIN_MESSAGES are available */
  force?: boolean
  displayName?: string
  /** 'self' profiles the user's own side of this chat */
  role?: 'contact' | 'self'
}

export interface CloneBuilder {
  start(contactId: string, opts?: CloneBuildOptions): Promise<void>
  cancel(contactId: string): void
  onStatus(cb: (e: { contactId: string; status: CloneStatus }) => void): () => void
  /** Live status of an in-flight build (undefined when idle). */
  status(contactId: string): CloneStatus | undefined
}

export interface CloneBuilderDeps {
  substrate: SubstrateService
  relationships: RelationshipStore
  /** Resolve the model to build with; `selection` is the per-build choice from the UI when given. */
  model: (selection?: ModelSelection) => Promise<ModelClient>
  now?: () => number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export const CLONE_STEPS = {
  read: '读取聊天记录',
  voice: '转写语音消息',
  group: '私聊语料不足，补充群聊发言',
  extract: '提炼说话风格、口头禅与回复习惯',
  merge: '合并画像',
  samples: '生成样本对话与检索语料',
  write: '写入本地画像 · 不上传',
} as const

const EXTRACT_CONCURRENCY = 3
/** Voice notes transcribed before building. Capped so one voice-heavy chat cannot stall the build. */
export const MAX_VOICE_TRANSCRIBE = 200

type StatusStore = RelationshipStore &
  Partial<{
    setStatus(contactId: string, status: CloneStatus, displayName?: string): Promise<void>
    clearCorrections(contactId: string): Promise<void>
    replacePairs(contactId: string, pairs: readonly PersonaPair[]): Promise<void>
  }>

class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createCloneBuilder(deps: CloneBuilderDeps): CloneBuilder {
  const now = deps.now ?? (() => Date.now())
  const log = deps.logger ?? (() => {})
  const relationships = deps.relationships as StatusStore
  const active = new Map<string, { controller: AbortController; status: CloneStatus }>()
  const listeners = new Set<(e: { contactId: string; status: CloneStatus }) => void>()

  const emit = (contactId: string, status: CloneStatus) => {
    const run = active.get(contactId)
    if (run) run.status = status
    for (const l of listeners) {
      try {
        l({ contactId, status })
      } catch {
        /* ignore */
      }
    }
  }

  const persist = async (contactId: string, status: CloneStatus, displayName: string) => {
    if (!relationships.setStatus) return
    try {
      await relationships.setStatus(contactId, status, displayName)
    } catch (e) {
      log('warn', 'clone: persist status failed', { contactId, error: errMsg(e) })
    }
  }

  const resolveDisplayName = async (contactId: string, given?: string): Promise<string> => {
    if (given?.trim()) return given.trim()
    try {
      const c = await deps.substrate.getContact(contactId)
      if (c) return c.remark?.trim() || c.nickname?.trim() || contactId
    } catch {
      /* fall through */
    }
    try {
      const s = await deps.substrate.getSession(contactId)
      if (s?.title) return s.title
    } catch {
      /* fall through */
    }
    return contactId
  }

  async function build(contactId: string, opts: CloneBuildOptions, controller: AbortController): Promise<void> {
    const signal = controller.signal
    const startedAt = now()
    const role = opts.role === 'self' ? 'self' : 'contact'
    const displayName = await resolveDisplayName(contactId, opts.displayName)
    const previous = await relationships.get(contactId)
    const names: CloneNames = role === 'self' ? { subjectName: '我', otherName: displayName, role } : { subjectName: displayName, otherName: '我', role }

    let total = 5
    let done = 0
    const progress = async (step: string, persistIt = false) => {
      if (signal.aborted) throw new CancelledError()
      const elapsed = now() - startedAt
      const eta = done > 0 ? Math.round((elapsed / done) * (total - done)) : undefined
      const status: CloneStatus = { state: 'building', progress: { done, total, step, startedAt, ...(eta !== undefined ? { etaMs: eta } : {}) } }
      emit(contactId, status)
      if (persistIt) await persist(contactId, status, displayName)
    }
    const fail = async (error: string, kind: 'model' | 'too_few_messages' | 'unknown') => {
      const status: CloneStatus = { state: 'failed', error, kind }
      emit(contactId, status)
      await persist(contactId, status, displayName)
    }

    await progress(CLONE_STEPS.read, true)

    // 1. read
    let messages
    try {
      messages = await loadContactMessages(deps.substrate, contactId, {
        max: MAX_MESSAGES,
        ...(opts.range?.from !== undefined ? { from: opts.range.from } : {}),
        ...(opts.range?.to !== undefined ? { to: opts.range.to } : {}),
        signal,
        onPage: (n) => {
          if (!signal.aborted) emit(contactId, { state: 'building', progress: { done, total, step: `${CLONE_STEPS.read}（${n} 条）`, startedAt } })
        },
      })
    } catch (e) {
      if (signal.aborted) throw new CancelledError()
      await fail(`读取聊天记录失败：${errMsg(e)}`, 'unknown')
      return
    }
    const subjectIsSelf = role === 'self'

    // 1b. transcribe the voice notes we have not seen yet. Skipping this silently drops every voice
    // message from the corpus — for someone who mostly speaks, that is the whole personality.
    await transcribeVoices(messages, signal, async (n, total_) => {
      await progress(`${CLONE_STEPS.voice}（${n}/${total_}）`)
    })

    if (messages.length < MIN_MESSAGES && !opts.force) {
      await fail(`与「${displayName}」的消息只有 ${messages.length} 条（至少需要 ${MIN_MESSAGES} 条），不足以克隆；可扩大范围或强制继续`, 'too_few_messages')
      return
    }
    const turns = mergeTurns(messages, subjectIsSelf)
    const stats: PersonaStats = computeStats(messages, turns, subjectIsSelf)
    let chunks = renderChunks(turns, names.subjectName, names.otherName)

    // 1c. thin DM + a contact who lives in group chats: borrow their group lines for the style half
    // only (see groupCorpus.ts — group replies answer other people, so they must not become pairs).
    // Never for a self-clone: what I say to a group is not what I say to this person.
    let group: GroupCorpus = EMPTY_GROUP_CORPUS
    if (!subjectIsSelf && stats.subjectMessageCount < MIN_MESSAGES) {
      await progress(CLONE_STEPS.group, true)
      try {
        group = await collectGroupCorpus(deps.substrate, contactId, displayName, {
          signal,
          onProgress: (detail) => {
            if (!signal.aborted) emit(contactId, { state: 'building', progress: { done, total, step: `${CLONE_STEPS.group}：${detail}`, startedAt } })
          },
        })
      } catch (e) {
        log('warn', 'clone: group corpus failed, DM only', { contactId, error: errMsg(e) })
      }
      if (group.messageCount > 0) {
        stats.groupMessageCount = group.messageCount
        stats.groupSessionCount = group.sessionCount
        chunks = selectChunks([...group.chunks, ...chunks], PROFILE_MAX_CHUNKS)
      }
    }

    if (chunks.length === 0 || stats.subjectMessageCount + (stats.groupMessageCount ?? 0) === 0) {
      await fail(`「${displayName}」没有可用的文本消息（语音未转写、或全是图片/表情）`, 'too_few_messages')
      return
    }
    done = 1
    total = 1 + chunks.length + (chunks.length > 1 ? 1 : 0) + 1 + 1
    const groupNote = group.messageCount > 0 ? `，另加 ${group.messageCount} 条群聊发言` : ''
    await progress(`${CLONE_STEPS.read}：${stats.messageCount} 条消息，${stats.transcribedVoiceCount}/${stats.voiceCount} 段语音已转写${groupNote}`)

    // 2. model
    let model: ModelClient
    try {
      model = await deps.model(opts.model)
    } catch (e) {
      await fail(`模型不可用：${errMsg(e)}`, 'model')
      return
    }

    // 3. extract per chunk
    await progress(`${CLONE_STEPS.extract}（0/${chunks.length}）`, true)
    const parts = await mapConcurrent(chunks, EXTRACT_CONCURRENCY, (chunk) => extractChunk(model, chunk, names, signal), (n) => {
      done = 1 + n
      if (!signal.aborted) void progress(`${CLONE_STEPS.extract}（${n}/${chunks.length}）`)
    })
    if (signal.aborted) throw new CancelledError()
    const valid = parts.filter((p): p is PersonaPartial => p !== undefined)
    if (valid.length === 0) {
      await fail('模型未能从聊天记录中提炼出画像（输出无法解析）', 'model')
      return
    }

    // 4. merge
    let merged: PersonaPartial
    if (valid.length > 1) {
      await progress(CLONE_STEPS.merge)
      try {
        merged = await mergeParts(model, valid, names, signal)
      } catch (e) {
        if (signal.aborted) throw new CancelledError()
        log('warn', 'clone: merge call failed, merging locally', { contactId, error: errMsg(e) })
        merged = mergeLocally(valid)
      }
      done++
    } else {
      merged = valid[0] as PersonaPartial
    }
    let { card, deep }: { card: PersonaCard; deep: PersonaDeep } = toCardAndDeep(merged)

    // 5. samples + retrieval corpus. `samples` is the handful shown in the editor; `pairs` is the
    // bulk corpus looked up at chat time, which is where most of the resemblance comes from.
    await progress(CLONE_STEPS.samples)
    const pairs = extractPairs(turns)
    let samples: PersonaSample[] = pickSamples(pairs)
    done++

    // 6. corrections + write
    await progress(CLONE_STEPS.write)
    const keep = opts.keepCorrections !== false
    let corrections: RelationshipProfile['corrections'] = []
    if (keep) {
      corrections = previous?.corrections ?? []
      const applied = applyCorrections(card, deep, corrections)
      card = applied.card
      deep = applied.deep
      // hand-corrected samples are user work: carry them over (deduped by reply text)
      const kept = (previous?.samples ?? []).filter((x) => x.corrected)
      const seen = new Set(samples.map((x) => x.reply))
      samples = [...samples, ...kept.filter((x) => (seen.has(x.reply) ? false : (seen.add(x.reply), true)))]
    } else if (relationships.clearCorrections) {
      await relationships.clearCorrections(contactId)
    }
    if (signal.aborted) throw new CancelledError()
    const profile: RelationshipProfile = {
      contactId,
      displayName: role === 'self' ? `我（对 ${displayName}）` : displayName,
      card,
      deep,
      samples,
      version: (previous?.version ?? 0) + 1,
      updatedAt: now(),
      role,
      corrections,
      stats,
    }
    await relationships.upsert(profile)
    if (relationships.replacePairs) {
      try {
        await relationships.replacePairs(contactId, pairs)
      } catch (e) {
        // the clone still works on the static samples alone; retrieval just stays empty
        log('warn', 'clone: writing the retrieval corpus failed', { contactId, error: errMsg(e) })
      }
    }
    done = total
    emit(contactId, { state: 'ready', version: profile.version, sampleCount: samples.length, builtAt: profile.updatedAt })
    log('info', 'clone: built', { contactId, version: profile.version, chunks: chunks.length, samples: samples.length, pairs: pairs.length, messages: stats.messageCount, groupMessages: stats.groupMessageCount ?? 0 })
  }

  /**
   * Fill in missing voice transcripts in place (bounded, newest first, failures ignored). Already
   * transcribed messages are untouched, so re-cloning does not spend the STT budget twice.
   */
  async function transcribeVoices(messages: WxMessage[], signal: AbortSignal, onProgress: (done: number, total: number) => Promise<void>): Promise<void> {
    const transcribe = deps.substrate.transcribeVoice
    if (!transcribe) return
    const pending = messages.filter((m) => m.kind === 'voice' && !m.media?.transcript).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_VOICE_TRANSCRIBE)
    if (pending.length === 0) return
    let n = 0
    for (const m of pending) {
      if (signal.aborted) break
      try {
        const text = (await transcribe.call(deps.substrate, m.sessionId, m.id)).trim()
        if (text) m.media = { ...(m.media ?? { kind: 'voice' }), kind: 'voice', transcript: text }
      } catch {
        // STT not configured / one bad file: keep going, the message simply stays out of the corpus
      }
      n++
      if (n % 5 === 0 || n === pending.length) await onProgress(n, pending.length)
    }
  }

  return {
    async start(contactId, opts = {}) {
      if (!contactId) throw new Error('contactId 不能为空')
      if (active.has(contactId)) throw new Error(`「${contactId}」正在克隆中`)
      const controller = new AbortController()
      active.set(contactId, { controller, status: { state: 'building', progress: { done: 0, total: 5, step: CLONE_STEPS.read, startedAt: now() } } })
      try {
        await build(contactId, opts, controller)
      } catch (e) {
        if (e instanceof CancelledError || controller.signal.aborted) {
          // restore the previous state
          const prev = await relationships.get(contactId)
          if (prev) {
            const status: CloneStatus = { state: 'ready', version: prev.version, sampleCount: prev.samples.length, builtAt: prev.updatedAt }
            await persist(contactId, status, prev.displayName)
            emit(contactId, status)
          } else {
            try {
              await relationships.remove(contactId)
            } catch {
              /* ignore */
            }
            emit(contactId, { state: 'none', messageCount: 0 })
          }
        } else {
          log('error', 'clone: build crashed', { contactId, error: errMsg(e) })
          const status: CloneStatus = { state: 'failed', error: errMsg(e), kind: 'unknown' }
          emit(contactId, status)
          await persist(contactId, status, opts.displayName ?? contactId)
        }
      } finally {
        active.delete(contactId)
      }
    },
    cancel(contactId) {
      active.get(contactId)?.controller.abort()
    },
    onStatus(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    status(contactId) {
      return active.get(contactId)?.status
    },
  }
}
