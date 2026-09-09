import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FragmentProviderContext, PersonaPair, SearchHit, SubstrateService, ThreadId } from '@aiwc/protocol'
import { PERSONA_BURST_MARKER, asThreadId, splitPersonaBubbles } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { personaFragmentProvider, personaIdentityProvider } from '../fragments/personaFragmentProvider'
import { createRelationshipStore } from '../relationship/relationshipStore'
import { createFakeSubstrate, createScriptedModel, fakeMessage, fakeSession, sampleProfile } from '../testing/fakes'
import { extractGroupSnippets, renderGroupChunks } from './groupCorpus'
import { searchPairs } from './pairs'
import { renderPersonaIdentity, renderPersonaTurn } from './personaPrompt'
import { reflectConversation, renderTranscript } from './reflect'

const tmp = () => mkdtempSync(join(tmpdir(), 'aiwc-persona-'))
const CONTACT = 'wxid_test01'
const THREAD = asThreadId('th_persona_0001')

const ctxFor = (profile: 'persona' | 'desktop-chat', userText = ''): FragmentProviderContext => ({
  threadId: THREAD,
  origin: { channel: 'desktop', peerId: CONTACT, chatId: CONTACT },
  settings: { permissionMode: 'ask', profile, allowAlways: [] },
  userText,
})

const pair = (over: Partial<PersonaPair> & { prompt: string; replies: string[] }): PersonaPair => ({ at: 1_700_000_000_000, ...over })

describe('persona prompt', () => {
  it('speaks in the first person, carries the mined profile and states the burst convention', () => {
    const text = renderPersonaIdentity(sampleProfile({ stats: { messageCount: 900, subjectMessageCount: 420, avgSubjectChars: 9, avgSubjectBurst: 2.4, voiceCount: 30, transcribedVoiceCount: 30, voiceRatio: 0.5 } }))
    expect(text.startsWith('<persona>')).toBe(true)
    expect(text).toContain('你是「李娜」')
    expect(text).toContain('不要承认或暗示自己是 AI')
    expect(text).toContain('哈哈哈、绝了') // catchphrases
    expect(text).toContain('先调侃再安慰') // reply habits
    expect(text).toContain('不聊前任') // boundaries survive into the prompt
    expect(text).toContain('随便／你定') // a real sample
    expect(text).toContain('单条 9 字左右') // length comes from the corpus, not a guess
    expect(text).toContain('一轮平均发 2.4 条')
    expect(text).toContain('几乎都发语音') // voiceRatio 0.5 → the loosest texting style
    expect(text).toContain(PERSONA_BURST_MARKER)
  })

  it('flips to the first person for a self clone and survives an empty profile', () => {
    expect(renderPersonaIdentity(sampleProfile({ role: 'self' }))).toContain('扮演使用这台电脑的用户本人')
    const bare = renderPersonaIdentity(sampleProfile({ card: { tone: [], traits: [], catchphrases: [], punctuation: '', addressing: {}, topics: [], replyHabits: {} }, deep: { facts: [], relationship: '', reactionPatterns: [], boundaries: [], sharedEvents: [] }, samples: [], stats: undefined }))
    expect(bare).toContain('没有提炼到明确的风格')
    expect(bare).toContain('单条 18 字左右') // falls back to a plausible default rather than 0
  })

  it('renders nothing when there is nothing to recall, and marks corrections as binding', () => {
    expect(renderPersonaTurn({})).toBe('')
    expect(renderPersonaTurn({ pairs: [], memories: [], notes: [] })).toBe('')
    const text = renderPersonaTurn({
      pairs: [pair({ prompt: '周末干嘛', replies: ['睡觉', '你呢'], context: '刚下班' })],
      memories: ['你: 上周去了青岛'],
      notes: [
        { at: 1, kind: 'correction', text: '不要说「你放心」' },
        { at: 2, kind: 'episode', text: '聊了搬家的事' },
      ],
    })
    expect(text).toContain('(之前聊到: 刚下班)')
    expect(text).toContain('你: 睡觉／你呢')
    expect(text).toContain('上周去了青岛')
    expect(text).toContain('不要说「你放心」')
    expect(text).toContain('必须遵守，优先级高于上面的一切')
  })

  it('does not repeat a pair that is already a static sample', () => {
    const p = pair({ prompt: '晚上吃啥', replies: ['随便'] })
    expect(renderPersonaTurn({ pairs: [p] })).toContain('晚上吃啥')
    expect(renderPersonaTurn({ pairs: [p], knownPrompts: new Set(['晚上吃啥']) })).toBe('')
  })

  it('splits a reply into bubbles, tolerating a half-streamed one', () => {
    expect(splitPersonaBubbles(`在的\n${PERSONA_BURST_MARKER}\n咋了`)).toEqual(['在的', '咋了'])
    expect(splitPersonaBubbles(`在的\n${PERSONA_BURST_MARKER}\n`)).toEqual(['在的'])
    expect(splitPersonaBubbles('一整段话')).toEqual(['一整段话'])
    expect(splitPersonaBubbles('')).toEqual([])
    // mid-stream the marker arrives a few characters at a time: never show the fragment to the user
    for (let i = 1; i <= PERSONA_BURST_MARKER.length; i++) {
      expect(splitPersonaBubbles(`在的\n${PERSONA_BURST_MARKER.slice(0, i)}`, true), PERSONA_BURST_MARKER.slice(0, i)).toEqual(['在的'])
    }
    expect(splitPersonaBubbles(`在的\n${PERSONA_BURST_MARKER}\n咋`, true)).toEqual(['在的', '咋'])
    // only the marker separates bubbles: a plain newline stays inside one bubble, dash and all
    expect(splitPersonaBubbles('在的\n哈哈-', true)).toEqual(['在的\n哈哈-'])
  })
})

describe('persona pair retrieval', () => {
  const corpus: PersonaPair[] = [
    pair({ prompt: '晚上一起吃饭吗', replies: ['行啊', '几点'] }),
    pair({ prompt: '中午吃饭去哪', replies: ['楼下那家'], at: 1_700_000_500_000 }),
    pair({ prompt: '明天开会几点', replies: ['十点'] }),
    pair({ prompt: '在吗', replies: ['嗯'] }),
    pair({ prompt: '周末去爬山不', replies: ['行啊', '几点'], at: 1_700_000_900_000 }),
  ]

  it('ranks by overlap with the current message and drops the noise', () => {
    const hits = searchPairs(corpus, '晚上吃饭去哪家')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.prompt).toMatch(/吃饭/)
    expect(hits.every((h) => h.score >= 0.18)).toBe(true)
    expect(hits.some((h) => h.prompt === '明天开会几点')).toBe(false)
    expect(searchPairs(corpus, '')).toEqual([])
    expect(searchPairs([], '吃饭')).toEqual([])
  })

  it('collapses duplicate replies so one stock answer cannot fill every slot', () => {
    // '行啊／几点' appears twice; only the higher-scoring one is kept
    const hits = searchPairs(corpus, '一起吃饭还是爬山')
    expect(hits.filter((h) => h.replies.join('') === '行啊几点')).toHaveLength(1)
  })

  it('uses the recent turns when the message alone says nothing', () => {
    const blind = searchPairs(corpus, '那你说呢')
    expect(blind).toEqual([])
    const withContext = searchPairs(corpus, '那你说呢', { contextQuery: '晚上一起吃饭吗\n那你说呢' })
    expect(withContext[0]?.prompt).toBe('晚上一起吃饭吗')
  })
})

describe('personaFragmentProvider', () => {
  const setup = async (over: Parameters<typeof sampleProfile>[0] = {}) => {
    const relationships = createRelationshipStore({ dir: tmp() })
    await relationships.upsert(sampleProfile(over))
    return relationships
  }

  it('gives a non-persona thread nothing at all', async () => {
    const relationships = await setup()
    expect(await personaIdentityProvider({ relationships }).provide(ctxFor('desktop-chat'))).toEqual([])
    expect(await personaFragmentProvider({ relationships }).provide(ctxFor('desktop-chat', '晚上吃啥'))).toEqual([])
  })

  it('emits the identity once per thread and recalls pairs + real excerpts per turn', async () => {
    const relationships = await setup()
    await relationships.replacePairs(CONTACT, [pair({ prompt: '晚上一起吃饭吗', replies: ['行啊', '几点'] })])
    const substrate: SubstrateService = {
      ...createFakeSubstrate({ sessions: [fakeSession({ id: CONTACT })], messages: [] }),
      search: async (): Promise<SearchHit[]> => [
        { message: fakeMessage({ sessionId: CONTACT, seq: 1, createdAt: 1, text: '上次那家川菜真香' }), score: 1, snippet: '上次那家川菜真香', source: 'fts' },
        { message: fakeMessage({ sessionId: CONTACT, seq: 2, createdAt: 2, isSelf: true, senderId: 'me', text: '是吧我也这么觉得' }), score: 1, snippet: '是吧我也这么觉得', source: 'fts' },
      ],
    }

    const identity = await personaIdentityProvider({ relationships }).provide(ctxFor('persona'))
    expect(identity.map((f) => f.kind)).toEqual(['persona'])
    expect(identity[0]?.render()).toContain('你是「李娜」')

    const turn = personaFragmentProvider({ relationships, substrate })
    const first = await turn.provide(ctxFor('persona', '晚上一起吃饭吗'))
    const recall = first.find((f) => f.kind === 'persona_recall')
    expect(recall?.render()).toContain('你: 行啊／几点')
    // excerpts are attributed from the clone's point of view: the contact is 你, the user is 对方
    expect(recall?.render()).toContain('你: 上次那家川菜真香')
    expect(recall?.render()).toContain('对方: 是吧我也这么觉得')
  })

  it('re-injects the corrections only when they change', async () => {
    const relationships = await setup()
    await relationships.addNotes(CONTACT, [{ kind: 'correction', text: '不要说「你放心」' }])
    const turn = personaFragmentProvider({ relationships })
    const first = await turn.provide(ctxFor('persona', '在吗'))
    expect(first.map((f) => f.kind)).toContain('persona_notes')
    const second = await turn.provide(ctxFor('persona', '在吗'))
    expect(second.map((f) => f.kind)).not.toContain('persona_notes')
    await relationships.addNotes(CONTACT, [{ kind: 'correction', text: '你喊我老张' }])
    const third = await turn.provide(ctxFor('persona', '在吗'))
    expect(third.find((f) => f.kind === 'persona_notes')?.render()).toContain('你喊我老张')
  })

  it('degrades to silence when the contact has no profile or the store misbehaves', async () => {
    const empty = createRelationshipStore({ dir: tmp() })
    expect(await personaIdentityProvider({ relationships: empty }).provide(ctxFor('persona'))).toEqual([])
    const relationships = await setup()
    const broken = { ...relationships, listPairs: async () => Promise.reject(new Error('disk gone')), listNotes: async () => Promise.reject(new Error('disk gone')) }
    expect(await personaFragmentProvider({ relationships: broken }).provide(ctxFor('persona', '在吗'))).toEqual([])
  })

  it('forgets a thread on reset (so a cleared transcript does not keep steering retrieval)', async () => {
    const relationships = await setup()
    await relationships.addNotes(CONTACT, [{ kind: 'correction', text: '不要说「你放心」' }])
    const turn = personaFragmentProvider({ relationships })
    await turn.provide(ctxFor('persona', '在吗'))
    turn.reset(THREAD as ThreadId)
    expect((await turn.provide(ctxFor('persona', '在吗'))).map((f) => f.kind)).toContain('persona_notes')
  })
})

describe('director notes store', () => {
  it('caps corrections and episodes separately, newest kept, and deletes by timestamp', async () => {
    const store = createRelationshipStore({ dir: tmp() })
    await store.addNotes(CONTACT, Array.from({ length: 25 }, (_, i) => ({ kind: 'correction' as const, text: `规则 ${i}` })))
    await store.addNotes(CONTACT, Array.from({ length: 12 }, (_, i) => ({ kind: 'episode' as const, text: `聊了 ${i}` })))
    const notes = await store.listNotes(CONTACT)
    const corrections = notes.filter((n) => n.kind === 'correction')
    const episodes = notes.filter((n) => n.kind === 'episode')
    expect(corrections).toHaveLength(20)
    expect(corrections[corrections.length - 1]?.text).toBe('规则 24')
    expect(episodes).toHaveLength(8)
    expect(episodes[0]?.text).toBe('聊了 4')
    await store.removeNote(CONTACT, corrections[0]?.at ?? 0)
    expect((await store.listNotes(CONTACT)).filter((n) => n.kind === 'correction')).toHaveLength(19)
    // blank notes never make it in
    await store.addNotes(CONTACT, [{ kind: 'correction', text: '   ' }])
    expect((await store.listNotes(CONTACT)).filter((n) => n.kind === 'correction')).toHaveLength(19)
  })

  it('tracks how much of a transcript has been reflected on, per thread', async () => {
    const store = createRelationshipStore({ dir: tmp() })
    expect(await store.getReflected(CONTACT, 'th_a')).toBe(0)
    await store.setReflected(CONTACT, 'th_a', 8)
    await store.setReflected(CONTACT, 'th_b', 3)
    expect(await store.getReflected(CONTACT, 'th_a')).toBe(8)
    expect(await store.getReflected(CONTACT, 'th_b')).toBe(3)
  })
})

describe('reflectConversation', () => {
  it('turns what the user said about the impersonation into rules plus one episode', async () => {
    const model = createScriptedModel(() => '```json\n{"corrections":["她不会说「你放心」，会说「安啦～」","她喊我老张"," "],"summary":"聊了搬家的事"}\n```')
    const notes = await reflectConversation(model, { displayName: '李娜', transcript: '我: 你放心\n李娜的分身: 你放心' })
    expect(notes).toEqual([
      { kind: 'correction', text: '她不会说「你放心」，会说「安啦～」' },
      { kind: 'correction', text: '她喊我老张' },
      { kind: 'episode', text: '聊了搬家的事' },
    ])
    expect(await reflectConversation(model, { displayName: '李娜', transcript: '  ' })).toEqual([])
  })

  it('renders the transcript oldest-first and keeps the most recent part when it is long', () => {
    const text = renderTranscript([{ role: 'user', text: '在吗' }, { role: 'assistant', text: '在' }, { role: 'user', text: '  ' }], '李娜')
    expect(text).toBe('我: 在吗\n李娜的分身: 在')
    const long = renderTranscript(Array.from({ length: 400 }, (_, i) => ({ role: 'user' as const, text: `第 ${i} 句话`.repeat(4) })), '李娜')
    expect(long.length).toBeLessThanOrEqual(6000)
    expect(long).toContain('第 399 句话') // the tail, not the head, is what matters
  })
})

describe('group corpus', () => {
  const groupMessages = () => {
    const base = 1_700_000_000_000
    return [
      fakeMessage({ sessionId: 'g@chatroom', seq: 1, createdAt: base, senderId: 'wxid_other', text: '周末团建去哪' }),
      fakeMessage({ sessionId: 'g@chatroom', seq: 2, createdAt: base + 10_000, senderId: CONTACT, text: '我投爬山' }),
      fakeMessage({ sessionId: 'g@chatroom', seq: 3, createdAt: base + 20_000, senderId: CONTACT, text: '别又是吃饭' }),
      fakeMessage({ sessionId: 'g@chatroom', seq: 4, createdAt: base + 30_000, isSelf: true, senderId: 'me', text: '我都行' }),
      // hours later: a new conversation, so the line above must not be treated as its context
      fakeMessage({ sessionId: 'g@chatroom', seq: 5, createdAt: base + 5 * 3_600_000, senderId: CONTACT, text: '睡了' }),
    ]
  }

  it('merges their bursts, attaches only fresh context and labels the provenance', () => {
    const snippets = extractGroupSnippets(groupMessages(), CONTACT)
    expect(snippets).toHaveLength(2)
    expect(snippets[0]?.texts).toEqual(['我投爬山', '别又是吃饭'])
    expect(snippets[0]?.contextText).toBe('周末团建去哪')
    expect(snippets[1]?.contextText).toBe('') // stale context dropped
    const chunks = renderGroupChunks(snippets, '李娜')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('在群聊里的发言节选')
    expect(chunks[0]).toContain('群友: 周末团建去哪')
    expect(chunks[0]).toContain('李娜: 我投爬山／别又是吃饭')
  })
})
