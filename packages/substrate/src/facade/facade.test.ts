import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmbeddingClient, SubstrateEvent, VoiceTranscriber } from '@aiwc/protocol'
import { createMirror, type Mirror } from '../mirror'
import { createDemoSourceReader } from '../demo/demoSource'
import type { FixtureInput } from '../demo/fixtureSchema'
import type { SourceReader } from '../source'
import { createSubstrateFacade, type SubstrateFacade } from './facade'

const T0 = Date.UTC(2026, 2, 1, 2, 0, 0)
const DM_COUNT = 1205 // > 2 pages of 500

function makeFixture(): FixtureInput {
  const messages: NonNullable<FixtureInput['messages']> = []
  for (let i = 1; i <= DM_COUNT; i++) {
    const self = i % 3 === 0
    const topic = i % 7 === 0 ? '发票明天寄出' : i % 11 === 0 ? 'roadmap 讨论' : `日常闲聊 ${i}`
    messages.push({ id: `a${i}`, sessionId: 'wxid_alpha', seq: i, createdAt: T0 + i * 60_000, senderId: self ? 'wxid_self' : 'wxid_alpha', senderName: self ? '我' : '阿尔法', isSelf: self, text: topic })
  }
  messages.push({ id: 'v1', sessionId: 'wxid_alpha', seq: DM_COUNT + 1, createdAt: T0 + (DM_COUNT + 1) * 60_000, senderId: 'wxid_alpha', kind: 'voice', text: '', media: { kind: 'voice', path: 'voice/v1.silk', durationMs: 3000 } })
  for (let i = 1; i <= 5; i++) messages.push({ id: `g${i}`, sessionId: 'demo1@chatroom', seq: i, createdAt: T0 + i * 1000, senderId: `wxid_m${i % 2}`, senderName: `成员${i % 2}`, text: `群里讨论产品市场 ${i}` })
  return {
    version: 1,
    account: { wxid: 'wxid_self', nickname: '演示' },
    sessions: [
      { id: 'wxid_alpha', title: '阿尔法', unread: 2 },
      { id: 'demo1@chatroom', title: '演示群', pinned: true },
    ],
    contacts: [
      { username: 'wxid_alpha', nickname: 'Alpha' },
      { username: 'wxid_m0', nickname: '成员0' },
      { username: 'wxid_m1', nickname: '成员1' },
    ],
    groupMembers: { 'demo1@chatroom': ['wxid_m0', 'wxid_m1'] },
    messages,
  }
}

let dir: string
let fixturePath: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-facade-'))
  fixturePath = join(dir, 'fixture.json')
  writeFileSync(fixturePath, JSON.stringify(makeFixture()), 'utf8')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const openOpts = () => ({ dbRoot: dir, wxid: 'wxid_self', dbKeyHex: '', cacheDir: dir })

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.()
})

function build(o: { embeddings?: EmbeddingClient; transcriber?: VoiceTranscriber; autoSyncOnOpen?: boolean; source?: SourceReader } = {}) {
  const mirror: Mirror = createMirror({ dbPath: ':memory:', embeddings: o.embeddings })
  const source = o.source ?? createDemoSourceReader({ fixturePath })
  const facade: SubstrateFacade = createSubstrateFacade({ source, mirror, transcriber: o.transcriber, cacheDir: dir, autoSyncOnOpen: o.autoSyncOnOpen ?? false, watchDebounceMs: 10 })
  const events: SubstrateEvent[] = []
  facade.subscribe((e) => events.push(e))
  cleanup.push(async () => {
    await facade.close()
    mirror.close()
  })
  return { mirror, source, facade, events }
}

describe('facade: connection & sync', () => {
  it('replaces account A sessions and messages with account B after reopening', async () => {
    const file = join(dir, 'switch-fixture.json')
    writeFileSync(file, JSON.stringify(makeFixture()))
    const { facade } = build({ source: createDemoSourceReader({ fixturePath: file }) })
    await facade.openWith(openOpts())
    await facade.sync()
    expect((await facade.listSessions({ limit: 10 })).items.map((s) => s.id)).toContain('wxid_alpha')
    writeFileSync(file, JSON.stringify({
      version: 1,
      account: { wxid: 'account_b', nickname: 'B', avatarPath: 'b.png' },
      sessions: [{ id: 'friend_b', kind: 'dm', title: 'B 的会话' }],
      contacts: [], messages: [],
    }))
    await facade.openWith({ ...openOpts(), wxid: 'account_b' })
    await facade.sync()
    expect((await facade.listSessions({ limit: 10 })).items.map((s) => s.id)).toEqual(['friend_b'])
    expect((await facade.listMessages({ sessionId: 'wxid_alpha', limit: 10 })).items).toEqual([])
    expect(facade.status().account).toMatchObject({ wxid: 'account_b', nickname: 'B' })
    expect(facade.status().account?.avatarPath).toContain('b.png')
  })

  it('walks no_config → connecting → ready and syncs in pages', async () => {
    const { facade, mirror, events } = build()
    expect(facade.status().connection).toBe('no_config')
    await facade.openWith(openOpts())
    expect(facade.status().connection).toBe('ready')
    expect(facade.status().account?.wxid).toBe('wxid_self')
    expect(events.filter((e) => e.type === 'connection').map((e) => (e as { state: string }).state)).toEqual(['connecting', 'ready'])
    expect(await facade.listAccounts()).toHaveLength(1)

    const status = await facade.sync()
    expect(status.phase).toBe('idle')
    expect(status.totals?.messages).toBe(DM_COUNT + 1 + 5)
    expect(status.totals?.sessions).toBe(2)
    expect(mirror.watermark('wxid_alpha')).toBe(DM_COUNT + 1)
    expect(mirror.countMessages('demo1@chatroom')).toBe(5)
    expect(mirror.hasGroupMembers('demo1@chatroom')).toBe(true)
    expect((await facade.listContacts({ limit: 10 })).total).toBe(3)

    const types = events.map((e) => e.type)
    expect(types).toContain('sessions.changed')
    expect(types).toContain('messages.changed')
    const syncs = events.filter((e) => e.type === 'sync')
    expect(syncs.some((e) => (e as { status: { phase: string } }).status.phase === 'syncing')).toBe(true)
    expect(facade.status().sync.phase).toBe('idle')

    // second sync is a no-op (nothing new)
    const before = events.length
    await facade.sync()
    expect(events.slice(before).filter((e) => e.type === 'messages.changed')).toHaveLength(0)

    const sessions = await facade.listSessions({ limit: 10 })
    expect(sessions.items[0]?.id).toBe('demo1@chatroom') // pinned first
    expect(sessions.items[1]?.indexedCount).toBe(DM_COUNT + 1)

    await facade.close()
    expect(facade.status().connection).toBe('no_config')
    expect(await facade.listAccounts()).toEqual([])
  })

  it('reports error / locked states and rejects sync when not open', async () => {
    const bad = join(dir, 'broken.json')
    writeFileSync(bad, '{"version":1}', 'utf8')
    const { facade } = build({ source: createDemoSourceReader({ fixturePath: bad }) })
    await expect(facade.openWith(openOpts())).rejects.toMatchObject({ code: 'fixture_invalid' })
    expect(facade.status().connection).toBe('error')
    await expect(facade.sync()).rejects.toMatchObject({ code: 'not_open' })

    const lockedSource: SourceReader = {
      ...createDemoSourceReader({ fixturePath }),
      async open() {
        throw new Error('file is not a database (wrong key)')
      },
    }
    const locked = build({ source: lockedSource })
    await expect(locked.facade.openWith(openOpts())).rejects.toThrow()
    expect(locked.facade.status().connection).toBe('locked')
  })

  it('coalesces concurrent sync calls and runs watch-triggered incremental syncs', async () => {
    const changeListeners: Array<(c: { sessionIds?: string[] }) => void> = []
    const base = createDemoSourceReader({ fixturePath })
    const watched: SourceReader = {
      ...base,
      watch(listener) {
        changeListeners.push(listener)
        return () => {}
      },
    }
    const { facade, mirror, events } = build({ source: watched, autoSyncOnOpen: true })
    await facade.openWith(openOpts())
    const [a, b] = await Promise.all([facade.sync(), facade.sync({ full: true })])
    expect(a).toBe(b)
    expect(mirror.countMessages()).toBe(DM_COUNT + 1 + 5)

    // remove the group's index then simulate a change notification → incremental sync repairs it
    await facade.removeIndex('demo1@chatroom')
    expect(mirror.countMessages('demo1@chatroom')).toBe(0)
    const before = events.length
    changeListeners.forEach((l) => l({ sessionIds: ['demo1@chatroom'] }))
    await new Promise((r) => setTimeout(r, 80))
    for (let i = 0; i < 50 && facade.syncEngine.running; i++) await new Promise((r) => setTimeout(r, 10))
    expect(mirror.countMessages('demo1@chatroom')).toBe(5)
    expect(events.slice(before).some((e) => e.type === 'messages.changed' && e.sessionIds.includes('demo1@chatroom'))).toBe(true)
  })
})

describe('facade: reads with live fallback', () => {
  it('uses the live tail when the mirror already contains a full but stale page', async () => {
    const { facade, mirror, source } = build()
    await facade.openWith(openOpts())
    const stale = await source.messagesAfter('wxid_alpha', 0, 100)
    mirror.insertMessages(stale)
    expect(mirror.listMessages({ sessionId: 'wxid_alpha', limit: 20 }).items.at(-1)?.seq).toBe(100)

    const latest = await facade.listMessages({ sessionId: 'wxid_alpha', limit: 20 })

    expect(latest.items.at(-1)?.seq).toBe(DM_COUNT + 1)
    expect(latest.items[0]?.seq).toBe(DM_COUNT - 18)
  })

  it('falls back to the source when the mirror is behind and backfills it', async () => {
    const { facade, mirror } = build()
    await facade.openWith(openOpts())
    expect(mirror.countMessages('wxid_alpha')).toBe(0)

    const latest = await facade.listMessages({ sessionId: 'wxid_alpha', limit: 20 })
    expect(latest.items).toHaveLength(20)
    expect(latest.items[latest.items.length - 1]?.seq).toBe(DM_COUNT + 1)
    expect(latest.hasMore).toBe(true)
    expect(mirror.countMessages('wxid_alpha')).toBe(20)

    const older = await facade.listMessages({ sessionId: 'wxid_alpha', beforeSeq: latest.items[0]!.seq, limit: 30 })
    expect(older.items).toHaveLength(30)
    expect(older.items[older.items.length - 1]!.seq).toBe(latest.items[0]!.seq - 1)
    expect(mirror.countMessages('wxid_alpha')).toBe(50)

    // reaching the beginning: live has nothing older → hasMore false and further calls stay local
    const head = await facade.listMessages({ sessionId: 'wxid_alpha', beforeSeq: 3, limit: 10 })
    expect(head.items.map((m) => m.seq)).toEqual([1, 2])
    expect(head.hasMore).toBe(false)
    const again = await facade.listMessages({ sessionId: 'wxid_alpha', beforeSeq: 3, limit: 10 })
    expect(again.hasMore).toBe(false)

    // forward paging and filtered queries stay on the mirror
    const fwd = await facade.listMessages({ sessionId: 'wxid_alpha', afterSeq: DM_COUNT - 1, limit: 10 })
    expect(fwd.items.map((m) => m.seq)).toEqual([DM_COUNT, DM_COUNT + 1])
    const filtered = await facade.listMessages({ sessionId: 'wxid_alpha', limit: 5, kinds: ['voice'] })
    expect(filtered.items.map((m) => m.id)).toEqual(['v1'])

    // context around an unsynced anchor pulls from the source
    const ctx = await facade.getContext({ sessionId: 'wxid_alpha', messageId: 'a600', seq: 600, createdAt: 0 }, 2)
    expect(ctx.map((m) => m.seq)).toEqual([598, 599, 600, 601, 602])
    expect(await facade.getMessage('wxid_alpha', 'a600')).toBeDefined()
  })

  it('serves group members, stats, media and voice transcripts with caching', async () => {
    const calls: string[] = []
    const transcriber: VoiceTranscriber = {
      async transcribe(path) {
        calls.push(path)
        return { text: '语音内容' }
      },
    }
    const { facade, mirror } = build({ transcriber })
    await facade.openWith(openOpts())
    await facade.sync()

    const members = await facade.listGroupMembers('demo1@chatroom')
    expect(members.total).toBe(2)
    expect(members.items.map((m) => m.nickname).sort()).toEqual(['成员0', '成员1'])
    expect((await facade.getContact('wxid_alpha'))?.nickname).toBe('Alpha')

    const ranking = await facade.stats({ metric: 'ranking', sessionId: 'wxid_alpha', limit: 2 })
    expect(ranking.rows).toHaveLength(2)
    expect(ranking.total).toBe(DM_COUNT + 1)

    const media = await facade.resolveMedia('wxid_alpha', 'v1')
    expect(media?.kind).toBe('voice')
    expect(media?.path).toBe(join(dir, 'voice/v1.silk'))
    await expect(facade.resolveMedia('wxid_alpha', 'nope')).rejects.toMatchObject({ code: 'not_found' })

    expect(await facade.transcribeVoice('wxid_alpha', 'v1')).toBe('语音内容')
    expect(await facade.transcribeVoice('wxid_alpha', 'v1')).toBe('语音内容')
    expect(calls).toHaveLength(1)
    expect(mirror.transcripts.get('wxid_alpha', 'v1')).toBe('语音内容')
    expect((await facade.getMessage('wxid_alpha', 'v1'))?.media?.transcript).toBe('语音内容')
    await facade.transcribeVoice('wxid_alpha', 'v1', { force: true })
    expect(calls).toHaveLength(2)

    const plain = build()
    await plain.facade.openWith(openOpts())
    await plain.facade.sync()
    await expect(plain.facade.transcribeVoice('wxid_alpha', 'v1')).rejects.toMatchObject({ code: 'unsupported' })

    await facade.setSessionFlags('wxid_alpha', { pinned: true, read: true })
    const s = await facade.getSession('wxid_alpha')
    expect(s?.pinned).toBe(true)
    expect(s?.unread).toBe(0)
    await facade.rebuildIndex('demo1@chatroom')
    expect(mirror.countMessages('demo1@chatroom')).toBe(5)
  })
})

describe('facade: search', () => {
  const toyEmbeddings: EmbeddingClient = {
    modelId: 'toy',
    dimensions: 3,
    async embed(values) {
      return values.map((t) => [t.includes('发票') ? 1 : 0.05, t.includes('roadmap') ? 1 : 0.05, 0.1])
    },
  }

  it('keyword → fts; semantic/hybrid without embeddings fall back to fts', async () => {
    const { facade } = build()
    await facade.openWith(openOpts())
    await facade.sync()
    const kw = await facade.search({ query: '产品市场', limit: 10, mode: 'keyword' })
    expect(kw.length).toBe(5)
    expect(kw.every((h) => h.source === 'fts')).toBe(true)
    const sem = await facade.search({ query: '产品市场', limit: 3, mode: 'semantic' })
    expect(sem).toHaveLength(3)
    expect(sem[0]?.source).toBe('fts')
    const hy = await facade.search({ query: 'roadmap', limit: 5, mode: 'hybrid', sessionIds: ['wxid_alpha'] })
    expect(hy.every((h) => h.source === 'fts')).toBe(true)
    expect(await facade.search({ query: '   ', limit: 5 })).toEqual([])
  })

  it('hybrid fuses fts and vector hits via RRF', async () => {
    const { facade, mirror } = build({ embeddings: toyEmbeddings })
    await facade.openWith(openOpts())
    await facade.sync()
    const hits = await facade.search({ query: '发票', limit: 10, mode: 'hybrid', sessionIds: ['wxid_alpha'] })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.source === 'fused')).toBe(true)
    expect(hits[0]?.source).toBe('fused')
    expect(hits[0]?.message.text).toContain('发票')
    // chunks were built lazily for the scoped session only
    expect(mirror.countMessages('demo1@chatroom')).toBe(5)
    const sem = await facade.search({ query: '发票', limit: 3, mode: 'semantic', sessionIds: ['wxid_alpha'] })
    expect(sem[0]?.source).toBe('vector')
    expect(sem[0]?.snippet).toContain('发票')
  })
})

describe('facade: querySql guardrails', () => {
  it('rejects writes, forces LIMIT, audits and forwards to the source', async () => {
    const { facade, mirror } = build()
    await facade.openWith(openOpts())
    await expect(facade.querySql({ db: 'message', sql: 'UPDATE messages SET text = 1' })).rejects.toMatchObject({ code: 'sql_rejected' })
    const r = await facade.querySql({ db: 'message', sql: 'SELECT id FROM messages WHERE session_id = \'wxid_alpha\' ORDER BY seq;' })
    expect(r.columns).toEqual(['id'])
    expect(r.rows).toHaveLength(200)
    const small = await facade.querySql({ db: 'message', sql: 'SELECT id FROM messages ORDER BY seq', limit: 3 })
    expect(small.rows).toHaveLength(3)
    const log = mirror.auditLog(10)
    expect(log).toHaveLength(2)
    expect(log[0]?.sql).toContain('LIMIT 3')
    expect(log[0]?.rows).toBe(3)
    expect(log[1]?.sql).toContain('LIMIT 200')
    await expect(facade.querySql({ db: 'message', sql: 'SELECT * FROM missing_table' })).rejects.toMatchObject({ code: 'sql_rejected' })
    expect(mirror.auditLog(1)[0]?.rows).toBe(-1)

    const noSql: SourceReader = { ...createDemoSourceReader({ fixturePath }) }
    delete (noSql as { querySql?: unknown }).querySql
    const other = build({ source: noSql })
    await other.facade.openWith(openOpts())
    await expect(other.facade.querySql({ db: 'message', sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'unsupported' })
  })
})

it('upgrades a previously indexed link in a filtered page and keeps it after source reads', async () => {
  const demo = createDemoSourceReader({ fixturePath })
  const source: SourceReader = { ...demo, kind: 'wcdb', async messagesAfter(id, seq, limit) {
    return (await demo.messagesAfter(id, seq, limit)).map((m) => ({ ...m, presentationVersion: 1, kind: 'system' as const, text: '我拍了拍好友' }))
  } }
  const { facade, mirror } = build({ source })
  await facade.openWith(openOpts())
  const old = (await demo.messagesAfter('wxid_alpha', 0, 1))[0]!
  mirror.insertMessages([{ ...old, kind: 'link', text: '我拍了拍好友' }])
  const page = await facade.listMessages({ sessionId: 'wxid_alpha', limit: 10, from: T0 })
  expect(page.items[0]).toMatchObject({ kind: 'system', presentationVersion: 1 })
  expect(mirror.getMessage('wxid_alpha', old.id)?.kind).toBe('system')
})
