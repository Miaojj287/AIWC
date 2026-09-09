/**
 * clone:* — persona profiles derived from a contact's real (demo) messages. clone:start streams
 * progress over ~6 s, then a generated RelationshipProfile; clone:chat replies in the contact's words.
 */
import type { AutoReplyRule, CloneStatus, PersonaNote, PersonaSample, RelationshipProfile, WxContact, WxMessage } from '@aiwc/protocol'
import { PERSONA_BURST_MARKER } from '@aiwc/protocol'
import { hashString, isAborted, type HandlersFor, type MockContext } from './core'
import { contactDisplayName } from './dataset'
import type { ScriptedAgent } from './agent'

const TONES = ['直接', '温和', '爱开玩笑', '简短', '细致', '热情', '偶尔吐槽', '务实'] as const
const TRAITS = ['回消息快', '喜欢用表情', '习惯先给结论', '会主动关心', '不喜欢打电话', '爱分享链接'] as const
const STEPS = ['读取消息', '提炼语气', '提炼事实', '生成样本', '校验画像'] as const
const MIN_MESSAGES = 20

interface CloneRecord {
  status: CloneStatus
  profile?: RelationshipProfile
  abort?: AbortController
  notes: PersonaNote[]
  /** transcript length already reflected on, per thread (mirrors the real reflect watermark) */
  reflected: Map<string, number>
}

const emptyRecord = (status: CloneStatus): CloneRecord => ({ status, notes: [], reflected: new Map() })

export interface CloneDeps {
  agent: ScriptedAgent
  rules: () => AutoReplyRule[]
}

export function cloneHandlers(ctx: MockContext, deps: CloneDeps): HandlersFor<'clone'> {
  const { data } = ctx
  const records = new Map<string, CloneRecord>()

  const dmContacts = (): WxContact[] =>
    [...data.sessions.values()].filter((s) => s.kind === 'dm').map((s) => data.contacts.get(s.id) ?? { username: s.id, nickname: s.title, kind: 'friend' as const })

  const theirMessages = (contactId: string): WxMessage[] => (data.messagesBySession.get(contactId) ?? []).filter((m) => !m.isSelf && m.kind !== 'system')
  /** What the real handler reports: the session's indexed total, not just their side. */
  const sessionMessageCount = (contactId: string): number => (data.messagesBySession.get(contactId) ?? []).length
  const theirTexts = (contactId: string): WxMessage[] => theirMessages(contactId).filter((m) => (m.kind === 'text' || m.kind === 'quote') && m.text.length > 0)

  const statusOf = (contactId: string): CloneStatus => records.get(contactId)?.status ?? { state: 'none', messageCount: sessionMessageCount(contactId) }
  const setStatus = (contactId: string, status: CloneStatus) => {
    const rec = records.get(contactId) ?? emptyRecord(status)
    rec.status = status
    records.set(contactId, rec)
    ctx.emit('clone:status', { contactId, status })
  }

  function buildProfile(contactId: string, previous: RelationshipProfile | undefined, keepCorrections: boolean): RelationshipProfile {
    const contact = data.contacts.get(contactId)
    const texts = theirTexts(contactId)
    const all = theirMessages(contactId)
    const h = hashString(contactId)
    const pickN = <T,>(pool: readonly T[], n: number, salt: number): T[] => {
      const out: T[] = []
      for (let i = 0; out.length < n && i < pool.length * 2; i++) {
        const item = pool[(h + salt * 7 + i * 13) % pool.length] as T
        if (!out.includes(item)) out.push(item)
      }
      return out
    }
    const freq = new Map<string, number>()
    for (const m of texts) if (m.text.length <= 6) freq.set(m.text, (freq.get(m.text) ?? 0) + 1)
    const catchphrases = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t)
    const exclaim = texts.filter((m) => /[！!]$/.test(m.text)).length
    const noPunct = texts.filter((m) => !/[。！？!?～~]$/.test(m.text)).length
    const punctuation = texts.length === 0 ? '未知' : exclaim / texts.length > 0.25 ? '常用感叹号' : noPunct / texts.length > 0.6 ? '句尾通常不加标点' : '句尾习惯加句号'
    const avgLen = texts.length ? Math.round(texts.reduce((n, m) => n + m.text.length, 0) / texts.length) : 0
    const hours = new Array<number>(24).fill(0)
    for (const m of all) hours[new Date(m.createdAt).getHours()] = (hours[new Date(m.createdAt).getHours()] ?? 0) + 1
    const peakHour = hours.indexOf(Math.max(...hours))
    const voiceRatio = all.length ? all.filter((m) => m.kind === 'voice').length / all.length : 0
    const topics = [...new Set(texts.filter((m) => m.text.length >= 8).map((m) => m.text.slice(0, 10)))].slice(0, 4)

    const samples: PersonaSample[] = []
    const session = data.messagesBySession.get(contactId) ?? []
    for (let i = 0; i < session.length - 1 && samples.length < 8; i++) {
      const mine = session[i]
      const reply = session[i + 1]
      if (mine?.isSelf && mine.kind === 'text' && reply && !reply.isSelf && reply.kind === 'text' && reply.createdAt - mine.createdAt < 30 * 60_000) samples.push({ prompt: mine.text, reply: reply.text, at: reply.createdAt })
    }
    const last = all[all.length - 1]
    const first = session[0]
    return {
      contactId,
      displayName: contactDisplayName(contact, contactId),
      card: {
        tone: pickN(TONES, 3, 1),
        traits: [...pickN(TRAITS, 2, 2), ...(voiceRatio > 0.05 ? ['爱发语音'] : [])],
        catchphrases,
        punctuation,
        addressing: { other: '你' },
        topics: topics.length ? topics : ['日常', '工作'],
        replyHabits: { 消息长度: `平均 ${avgLen} 字`, 活跃时段: `${String(peakHour).padStart(2, '0')}:00 前后`, 常用开头: texts[0]?.text.slice(0, 2) ?? '—' },
      },
      deep: {
        facts: [`近 90 天共 ${all.length} 条消息`, last ? `最近一次联系：${new Date(last.createdAt).toLocaleDateString('zh-CN')}` : '暂无联系记录'],
        relationship: contact?.remark ? `备注为「${contact.remark}」` : '微信好友',
        reactionPatterns: ['被问问题时先给结论，再补细节', '收到长消息会分几条回复'],
        boundaries: ['不聊转账、密码等敏感信息', '不代替本人做承诺'],
        sharedEvents: first ? [{ when: new Date(first.createdAt).toLocaleDateString('zh-CN'), what: '开始聊天' }] : [],
      },
      samples,
      version: (previous?.version ?? 0) + 1,
      updatedAt: ctx.now(),
      role: 'contact',
      corrections: keepCorrections ? previous?.corrections ?? [] : [],
    }
  }

  async function start(contactId: string, keepCorrections: boolean): Promise<void> {
    const rec = records.get(contactId) ?? emptyRecord(statusOf(contactId))
    records.set(contactId, rec)
    const abort = new AbortController()
    rec.abort = abort
    const startedAt = ctx.now()
    const total = STEPS.length
    const perStep = 1200
    try {
      for (let i = 0; i < total; i++) {
        setStatus(contactId, { state: 'building', progress: { done: i, total, step: STEPS[i] as string, startedAt, etaMs: (total - i) * perStep } })
        await ctx.delay(perStep, abort.signal)
      }
      if (theirMessages(contactId).length < MIN_MESSAGES) {
        setStatus(contactId, { state: 'failed', error: `有效消息只有 ${theirMessages(contactId).length} 条，不足以提炼画像`, kind: 'too_few_messages' })
        return
      }
      const profile = buildProfile(contactId, rec.profile, keepCorrections)
      rec.profile = profile
      setStatus(contactId, { state: 'ready', version: profile.version, sampleCount: profile.samples.length, builtAt: ctx.now() })
      ctx.emit('app:toast', { kind: 'success', text: `「${profile.displayName}」的分身已就绪` })
    } catch (err) {
      if (isAborted(err)) setStatus(contactId, rec.profile ? { state: 'ready', version: rec.profile.version, sampleCount: rec.profile.samples.length, builtAt: rec.profile.updatedAt } : { state: 'none', messageCount: sessionMessageCount(contactId) })
      else setStatus(contactId, { state: 'failed', error: err instanceof Error ? err.message : String(err), kind: 'unknown' })
    } finally {
      rec.abort = undefined
    }
  }

  function personaReply(contactId: string, userText: string): string {
    const texts = theirTexts(contactId)
    if (texts.length === 0) return '嗯'
    const grams = new Set<string>()
    for (let i = 0; i < userText.length - 1; i++) grams.add(userText.slice(i, i + 2))
    const scored = texts.map((m) => ({ m, s: [...grams].filter((g) => m.text.includes(g)).length }))
    const best = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5)
    const chosen = best.length ? ctx.rng.pick(best).m : ctx.rng.pick(texts)
    const catchphrase = records.get(contactId)?.profile?.card.catchphrases[0]
    // real clones answer in several short bubbles; keep the preview honest about that
    if (catchphrase && ctx.rng.chance(0.35) && chosen.text !== catchphrase) return `${chosen.text}\n${PERSONA_BURST_MARKER}\n${catchphrase}`
    return chosen.text
  }

  return {
    'clone:list': () =>
      dmContacts().map((c) => {
        const msgs = theirMessages(c.username)
        return { contactId: c.username, displayName: contactDisplayName(c, c.username), status: statusOf(c.username), messageCount: sessionMessageCount(c.username), lastContactAt: msgs[msgs.length - 1]?.createdAt, avatarPath: data.sessions.get(c.username)?.avatarPath }
      }),
    'clone:get': ({ contactId }) => records.get(contactId)?.profile,
    'clone:status': ({ contactId }) => statusOf(contactId),
    'clone:sampleMessages': ({ contactId, limit = 20 }) => {
      const texts = theirTexts(contactId)
      const picked = new Set<WxMessage>()
      for (let i = 0; i < limit * 3 && picked.size < Math.min(limit, texts.length); i++) picked.add(ctx.rng.pick(texts))
      return [...picked].sort((a, b) => a.createdAt - b.createdAt)
    },
    'clone:start': ({ contactId, keepCorrections = true }) => {
      const status = statusOf(contactId)
      if (status.state === 'building') return
      void start(contactId, keepCorrections)
    },
    'clone:cancel': ({ contactId }) => {
      records.get(contactId)?.abort?.abort()
    },
    'clone:delete': ({ contactId }) => {
      records.get(contactId)?.abort?.abort()
      records.delete(contactId)
      ctx.emit('clone:status', { contactId, status: statusOf(contactId) })
      return { affectedRules: [] }
    },
    'clone:updateProfile': ({ contactId, patch }) => {
      const rec = records.get(contactId)
      if (!rec?.profile) throw new Error('该联系人还没有克隆画像')
      rec.profile = { ...rec.profile, ...patch, updatedAt: ctx.now() }
      return rec.profile
    },
    'clone:chat': async ({ contactId, threadId, text }) => {
      const name = contactDisplayName(data.contacts.get(contactId), contactId)
      deps.agent.ensureThread(threadId, { channel: 'desktop', peerId: contactId }, { profile: 'persona', permissionMode: 'ask', title: `与「${name}」的分身试聊` })
      await deps.agent.replyInThread(threadId, text, personaReply(contactId, text))
    },
    'clone:feedback': ({ contactId, messageItemId, verdict, correction, saveAsSample }) => {
      const rec = records.get(contactId)
      if (!rec?.profile) return
      if (correction) {
        rec.profile.corrections.push({ at: ctx.now(), field: `reply:${messageItemId}`, from: verdict, to: correction })
        if (saveAsSample) rec.profile.samples.push({ prompt: '（手动纠正）', reply: correction, at: ctx.now(), corrected: true })
        rec.profile.updatedAt = ctx.now()
        if (verdict === 'not_like') rec.notes.push({ at: ctx.now(), kind: 'correction', text: `对方指出上一条不像${rec.profile.displayName}，并说明：${correction}` })
      }
      ctx.emit('app:toast', { kind: 'success', text: verdict === 'up' ? '已记录：这条像本人' : '已记录反馈，下次会更像' })
    },
    'clone:notes': ({ contactId }) => records.get(contactId)?.notes ?? [],
    'clone:deleteNote': ({ contactId, at }) => {
      const rec = records.get(contactId)
      if (rec) rec.notes = rec.notes.filter((n) => n.at !== at)
    },
    'clone:reflect': ({ contactId, threadId }) => {
      const rec = records.get(contactId)
      if (!rec?.profile) return { ok: false, corrections: 0 }
      const count = deps.agent.messageCount(threadId)
      const seen = rec.reflected.get(String(threadId)) ?? 0
      if (count < 6 || count - seen < 6) return { ok: false, corrections: 0 }
      rec.reflected.set(String(threadId), count)
      const episode = `聊了 ${count} 条消息`
      rec.notes.push({ at: ctx.now(), kind: 'episode', text: episode })
      return { ok: true, corrections: 0, episode }
    },
  }
}
