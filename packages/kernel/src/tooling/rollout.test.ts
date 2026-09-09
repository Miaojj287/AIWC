import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, promises as fsp, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asItemId, asThreadId, asTurnId, newStepId, type HistoryItem, type ThreadSettings } from '@aiwc/protocol'
import { createRolloutStore, type RolloutStoreExt } from './rollout'

const settings: ThreadSettings = { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] }
const origin = { channel: 'desktop' as const }
let root: string
let store: RolloutStoreExt
let t = 1000

const user = (id: string, text: string): HistoryItem => ({
  type: 'user_message',
  id: asItemId(id),
  turnId: asTurnId('trn_1'),
  createdAt: t++,
  content: [{ type: 'text', text }],
  mentions: [],
})
const assistant = (id: string, text: string): HistoryItem => ({
  type: 'assistant_message',
  id: asItemId(id),
  turnId: asTurnId('trn_1'),
  stepId: newStepId(),
  createdAt: t++,
  text,
})
const summary = (id: string, through: string): HistoryItem => ({
  type: 'compaction_summary',
  id: asItemId(id),
  createdAt: t++,
  summary: '前情提要',
  foldedItemCount: 2,
  foldedThroughId: asItemId(through),
  tokenEstimate: 10,
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-rollout-'))
  store = createRolloutStore({ dir: join(root, 'rollouts'), indexDbPath: join(root, 'index.db') })
})
afterEach(async () => {
  await store.close()
  rmSync(root, { recursive: true, force: true })
})

describe('createRolloutStore', () => {
  it('create writes thread_meta and indexes the thread', async () => {
    const id = asThreadId('thr_a')
    await store.create({ threadId: id, origin, settings, title: '第一个' })
    const raw = await fsp.readFile(store.pathFor(id), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(raw)).toMatchObject({ type: 'thread_meta', threadId: 'thr_a', title: '第一个' })
    const [rec] = await store.list()
    expect(rec).toMatchObject({ threadId: 'thr_a', title: '第一个', itemCount: 0, pinned: false, archived: false })
  })

  it('append is serialised per thread; flush is a barrier; resume replays items and settings', async () => {
    const id = asThreadId('thr_b')
    await store.create({ threadId: id, origin, settings })
    const writes = []
    for (let i = 0; i < 20; i++) writes.push(store.append(id, [{ ts: i, type: 'item', item: user(`u${i}`, `消息 ${i}`) }]))
    void store.append(id, [{ ts: 99, type: 'settings', settings: { ...settings, permissionMode: 'bypass' } }])
    await store.flush(id)
    await Promise.all(writes)
    const lines = (await fsp.readFile(store.pathFor(id), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(22)
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow())
    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(Array.from({ length: 20 }, (_, i) => `u${i}`))
    expect(state?.settings.permissionMode).toBe('bypass')
    expect(state?.origin).toEqual(origin)
    expect((await store.list())[0]?.itemCount).toBe(20)
  })

  it('resume honours the LAST compaction checkpoint and keeps the summary item (summary written right after the fold point)', async () => {
    const id = asThreadId('thr_c')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [
      { ts: 1, type: 'item', item: user('u1', 'a') },
      { ts: 2, type: 'item', item: assistant('a1', 'b') },
      { ts: 3, type: 'item', item: summary('s1', 'a1') },
      { ts: 4, type: 'compacted', summaryItemId: asItemId('s1'), foldedThroughId: asItemId('a1') },
      { ts: 5, type: 'item', item: user('u2', 'c') },
      { ts: 6, type: 'item', item: assistant('a2', 'd') },
      { ts: 7, type: 'item', item: summary('s2', 'a2') },
      { ts: 8, type: 'compacted', summaryItemId: asItemId('s2'), foldedThroughId: asItemId('a2') },
      { ts: 9, type: 'item', item: user('u3', 'e') },
      { ts: 10, type: 'world_state', snapshot: { permissionMode: 'ask' } },
      { ts: 11, type: 'world_state', snapshot: { permissionMode: 'bypass' } },
    ])
    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(['s2', 'u3'])
    expect(state?.lastCompactedThroughId).toBe('a2')
    expect(state?.worldState).toEqual({ permissionMode: 'bypass' })
  })

  it('production ordering (prefix, tail, summary, compacted): resume keeps the preserved tail after the summary', async () => {
    // compactContext records the summary at the END of live history and then persists the checkpoint,
    // so the file reads prefix…, tail…, summary, compacted. forPrompt() before restart = [s1, u2, a2].
    const id = asThreadId('thr_c3')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [
      { ts: 1, type: 'item', item: user('u1', 'a') },
      { ts: 2, type: 'item', item: assistant('a1', 'b') },
      { ts: 3, type: 'item', item: user('u2', 'c') },
      { ts: 4, type: 'item', item: assistant('a2', 'd') },
      { ts: 5, type: 'item', item: summary('s1', 'a1') },
      { ts: 6, type: 'compacted', summaryItemId: asItemId('s1'), foldedThroughId: asItemId('a1') },
    ])
    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(['s1', 'u2', 'a2'])
    expect(state?.lastCompactedThroughId).toBe('a1')
  })

  it('production ordering with two successive compactions folds the previous summary and keeps the latest tail', async () => {
    const id = asThreadId('thr_c4')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [
      { ts: 1, type: 'item', item: user('u1', 'a') },
      { ts: 2, type: 'item', item: assistant('a1', 'b') },
      { ts: 3, type: 'item', item: user('u2', 'c') },
      { ts: 4, type: 'item', item: assistant('a2', 'd') },
      { ts: 5, type: 'item', item: summary('s1', 'a1') },
      { ts: 6, type: 'compacted', summaryItemId: asItemId('s1'), foldedThroughId: asItemId('a1') },
      // live history is now [s1, u2, a2]; next turn appends u3/a3, then compaction folds through a2
      { ts: 7, type: 'item', item: user('u3', 'e') },
      { ts: 8, type: 'item', item: assistant('a3', 'f') },
      { ts: 9, type: 'item', item: summary('s2', 'a2') },
      { ts: 10, type: 'compacted', summaryItemId: asItemId('s2'), foldedThroughId: asItemId('a2') },
      { ts: 11, type: 'item', item: user('u4', 'g') },
    ])
    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(['s2', 'u3', 'a3', 'u4'])
    expect(state?.lastCompactedThroughId).toBe('a2')
  })

  it('compacted line written before its summary item still resumes correctly', async () => {
    const id = asThreadId('thr_c2')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [
      { ts: 1, type: 'item', item: user('u1', 'a') },
      { ts: 2, type: 'item', item: assistant('a1', 'b') },
      { ts: 3, type: 'compacted', summaryItemId: asItemId('s1'), foldedThroughId: asItemId('a1') },
      { ts: 4, type: 'item', item: summary('s1', 'a1') },
      { ts: 5, type: 'item', item: user('u2', 'c') },
    ])
    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(['s1', 'u2'])
  })

  it('skips a corrupt trailing line', async () => {
    const id = asThreadId('thr_d')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [{ ts: 1, type: 'item', item: user('u1', 'ok') }])
    await fsp.appendFile(store.pathFor(id), '{"ts":2,"type":"item","item":{"type":"user_mess')
    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(['u1'])
  })

  it('resume of unknown thread → undefined', async () => {
    expect(await store.resume(asThreadId('thr_none'))).toBeUndefined()
  })

  it('list: ordering, query (title / fts), channel filter, archived, limit', async () => {
    await store.create({ threadId: asThreadId('thr_1'), origin, settings, title: '周报' })
    await store.create({ threadId: asThreadId('thr_2'), origin: { channel: 'wechat-ilink', chatId: 'x' }, settings, title: '机器人' })
    await store.create({ threadId: asThreadId('thr_3'), origin, settings, title: '旧的' })
    await store.append(asThreadId('thr_1'), [{ ts: 1, type: 'item', item: user('u1', '帮我总结一下项目进度') }])
    await store.updateMeta(asThreadId('thr_3'), { pinned: true })
    let list = await store.list()
    expect(list.map((r) => r.threadId)).toEqual(['thr_3', 'thr_1', 'thr_2'])
    expect((await store.list({ query: '项目进度' })).map((r) => r.threadId)).toEqual(['thr_1'])
    expect((await store.list({ query: '机器' })).map((r) => r.threadId)).toEqual(['thr_2'])
    expect((await store.list({ channel: 'wechat-ilink' })).map((r) => r.threadId)).toEqual(['thr_2'])
    await store.updateMeta(asThreadId('thr_2'), { archived: true, title: '归档了' })
    list = await store.list()
    expect(list.map((r) => r.threadId)).toEqual(['thr_3', 'thr_1'])
    expect((await store.list({ includeArchived: true })).find((r) => r.threadId === 'thr_2')?.title).toBe('归档了')
    expect(await store.list({ limit: 1 })).toHaveLength(1)
  })

  it('updateMeta(settings) appends a settings line so resume sees it', async () => {
    const id = asThreadId('thr_s')
    await store.create({ threadId: id, origin, settings })
    await store.updateMeta(id, { settings: { ...settings, profile: 'subagent' } })
    const state = await store.resume(id)
    expect(state?.settings.profile).toBe('subagent')
    const lines = (await fsp.readFile(store.pathFor(id), 'utf8')).trim().split('\n')
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: 'settings' })
  })

  it('search: fts snippet for ≥3 chars, LIKE fallback for short queries, threadId filter', async () => {
    const a = asThreadId('thr_x')
    const b = asThreadId('thr_y')
    await store.create({ threadId: a, origin, settings })
    await store.create({ threadId: b, origin, settings })
    await store.append(a, [
      { ts: 1, type: 'item', item: user('u1', '明天下午三点开会讨论预算') },
      { ts: 2, type: 'item', item: assistant('a1', '好的，我记下了 hello world') },
    ])
    await store.append(b, [{ ts: 3, type: 'item', item: user('u2', '预算表在哪里') }])
    const hits = await store.search('预算')
    expect(hits.map((h) => h.threadId).sort()).toEqual(['thr_x', 'thr_y'])
    expect(hits.every((h) => h.snippet.includes('[预算]'))).toBe(true)
    const only = await store.search('讨论预算', { threadId: a })
    expect(only).toHaveLength(1)
    expect(only[0]).toMatchObject({ threadId: 'thr_x', itemId: 'u1' })
    expect(only[0]?.snippet).toContain('[讨论预算]')
    expect((await store.search('hello world')).map((h) => h.itemId)).toEqual(['a1'])
    expect(await store.search('不存在的词')).toEqual([])
    expect(await store.search('a"b(')).toEqual([])
    expect(await store.search('')).toEqual([])
  })

  it('remove deletes file and rows', async () => {
    const id = asThreadId('thr_r')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [{ ts: 1, type: 'item', item: user('u1', '删除我吧') }])
    await store.remove(id)
    expect(await store.list()).toEqual([])
    expect(await store.search('删除我吧')).toEqual([])
    await expect(fsp.access(store.pathFor(id))).rejects.toThrow()
    expect(await store.resume(id)).toBeUndefined()
  })

  it('rejects unsafe thread ids', async () => {
    await expect(store.create({ threadId: asThreadId('../evil'), origin, settings })).rejects.toThrow(/invalid thread id/)
  })
})

describe('rewrite', () => {
  it('atomically replaces the file, preserves meta, refreshes index + FTS, and round-trips via resume', async () => {
    const id = asThreadId('thr_rw')
    await store.create({ threadId: id, origin, settings, title: '原标题' })
    await store.updateMeta(id, { pinned: true })
    const createdAt = (await store.list())[0]!.createdAt
    await store.append(id, [
      { ts: 1, type: 'item', item: user('u1', '旧的第一条消息') },
      { ts: 2, type: 'item', item: assistant('a1', '旧的回复') },
      { ts: 3, type: 'item', item: user('u2', '第二条消息') },
      { ts: 4, type: 'item', item: assistant('a2', '第二条回复') },
      { ts: 5, type: 'item', item: summary('s1', 'a1') },
      { ts: 6, type: 'compacted', summaryItemId: asItemId('s1'), foldedThroughId: asItemId('a1') },
      { ts: 7, type: 'item', item: user('u3', '将被回滚的消息') },
    ])
    expect((await store.resume(id))?.items.map((i) => i.id)).toEqual(['s1', 'u2', 'a2', 'u3'])

    // rollback: drop u3, change settings, keep the compaction checkpoint, add world state
    const live = [summary('s1', 'a1'), user('u2', '第二条消息'), assistant('a2', '第二条回复')]
    const newSettings: ThreadSettings = { ...settings, permissionMode: 'bypass' }
    await store.rewrite(id, { items: live, settings: newSettings, lastCompactedThroughId: asItemId('a1'), worldState: { permissionMode: 'bypass' } })

    const raw = await fsp.readFile(store.pathFor(id), 'utf8')
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l) as { type: string; ts: number; title?: string })
    expect(lines.map((l) => l.type)).toEqual(['thread_meta', 'compacted', 'item', 'item', 'item', 'world_state'])
    expect(lines[0]).toMatchObject({ ts: createdAt, title: '原标题', threadId: 'thr_rw', settings: newSettings })
    expect((await fsp.readdir(join(root, 'rollouts'))).filter((f) => f.endsWith('.tmp'))).toEqual([])

    const state = await store.resume(id)
    expect(state?.items.map((i) => i.id)).toEqual(['s1', 'u2', 'a2'])
    expect(state?.settings).toEqual(newSettings)
    expect(state?.title).toBe('原标题')
    expect(state?.lastCompactedThroughId).toBe('a1')
    expect(state?.worldState).toEqual({ permissionMode: 'bypass' })

    const [rec] = await store.list()
    expect(rec).toMatchObject({ threadId: 'thr_rw', title: '原标题', pinned: true, archived: false, createdAt, itemCount: 3, settings: newSettings })
    expect((await store.search('将被回滚')).length).toBe(0)
    expect((await store.search('旧的第一条')).length).toBe(0)
    expect((await store.search('第二条回复')).map((h) => h.itemId)).toEqual(['a2'])

    // appends after a rewrite land on the new file
    await store.append(id, [{ ts: 8, type: 'item', item: user('u4', '新消息') }])
    expect((await store.resume(id))?.items.map((i) => i.id)).toEqual(['s1', 'u2', 'a2', 'u4'])
    expect((await store.list())[0]?.itemCount).toBe(4)
  })

  it('without a checkpoint or world state writes only meta + items; summary anywhere in live history is kept in place', async () => {
    const id = asThreadId('thr_rw2')
    await store.create({ threadId: id, origin, settings })
    await store.append(id, [{ ts: 1, type: 'item', item: user('u1', 'x') }])
    await store.rewrite(id, { items: [], settings })
    const state = await store.resume(id)
    expect(state?.items).toEqual([])
    expect(state?.lastCompactedThroughId).toBeUndefined()
    expect(state?.worldState).toBeUndefined()
    expect((await store.list())[0]?.itemCount).toBe(0)
  })

  it('unknown thread → rejects', async () => {
    await expect(store.rewrite(asThreadId('thr_missing'), { items: [], settings })).rejects.toThrow(/unknown thread/)
  })
})
