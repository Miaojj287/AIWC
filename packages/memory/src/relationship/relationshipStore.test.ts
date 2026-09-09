import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sampleProfile } from '../testing/fakes'
import { createRelationshipStore, folderNameFor } from './relationshipStore'

const tmp = () => mkdtempSync(join(tmpdir(), 'aiwc-rel-'))

describe('createRelationshipStore', () => {
  it('encodes folder names safely', () => {
    expect(folderNameFor('wxid_abc')).toBe('wxid_abc')
    expect(folderNameFor('a/b c')).toBe('a%2fb%20c')
    expect(folderNameFor('12345@chatroom')).toBe('12345@chatroom')
  })

  it('round-trips a profile through upsert/get and derives list/status', async () => {
    const dir = tmp()
    const store = createRelationshipStore({ dir })
    expect(await store.status('wxid_test01')).toEqual({ state: 'none', messageCount: 0 })
    expect(await store.get('wxid_test01')).toBeUndefined()
    await store.upsert(sampleProfile())
    const got = await store.get('wxid_test01')
    expect(got).toEqual(sampleProfile())
    expect(await store.status('wxid_test01')).toEqual({ state: 'ready', version: 1, sampleCount: 2, builtAt: 1700000200000 })
    expect(await store.list()).toEqual([{ contactId: 'wxid_test01', displayName: '李娜', status: { state: 'ready', version: 1, sampleCount: 2, builtAt: 1700000200000 } }])
    expect(existsSync(join(dir, 'wxid_test01', 'profile.json'))).toBe(true)
    expect(readFileSync(join(dir, 'wxid_test01', 'samples.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('keeps corrections across re-clones unless explicitly cleared', async () => {
    const store = createRelationshipStore({ dir: tmp() })
    await store.upsert(sampleProfile())
    await store.appendCorrection('wxid_test01', { at: 1, field: 'card.catchphrases', from: '绝了', to: '离谱' })
    // re-clone passes an empty corrections array → nothing is lost
    await store.upsert(sampleProfile({ version: 2, corrections: [] }))
    expect((await store.get('wxid_test01'))?.corrections).toEqual([{ at: 1, field: 'card.catchphrases', from: '绝了', to: '离谱' }])
    // passing the same correction again does not duplicate it
    await store.upsert(sampleProfile({ version: 3, corrections: [{ at: 1, field: 'card.catchphrases', from: '绝了', to: '离谱' }, { at: 2, field: 'card.tone', from: '', to: '更冷淡' }] }))
    expect((await store.listCorrections('wxid_test01')).map((c) => c.at)).toEqual([1, 2])
    await store.clearCorrections('wxid_test01')
    expect(await store.listCorrections('wxid_test01')).toEqual([])
  })

  it('persists intermediate statuses, heals stale building, removes folders and notifies', async () => {
    const dir = tmp()
    const store = createRelationshipStore({ dir })
    const events: string[] = []
    store.subscribe((e) => events.push(`${e.contactId}:${e.status.state}`))
    await store.setStatus('wxid_b', { state: 'building', progress: { done: 1, total: 4, step: '读取聊天记录', startedAt: Date.now() } }, '王伟')
    expect(await store.list()).toEqual([{ contactId: 'wxid_b', displayName: '王伟', status: expect.objectContaining({ state: 'building' }) }])
    // a store opened later than the build started sees a crashed build → failed
    const reopened = createRelationshipStore({ dir, now: () => Date.now() + 60_000 })
    expect(await reopened.status('wxid_b')).toEqual({ state: 'failed', error: expect.stringContaining('未完成'), kind: 'unknown' })
    await store.remove('wxid_b')
    expect(await store.list()).toEqual([])
    expect(existsSync(join(dir, 'wxid_b'))).toBe(false)
    expect(events).toEqual(['wxid_b:building', 'wxid_b:none'])
  })
})
