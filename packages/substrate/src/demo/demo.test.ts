import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDemoSourceReader, normaliseFixture } from './demoSource'
import { FixtureSchema, type FixtureInput } from './fixtureSchema'

const fixture: FixtureInput = {
  version: 1,
  account: { wxid: 'wxid_demo_self', nickname: '演示账号', dbRoot: '' },
  sessions: [
    { id: 'wxid_alpha', title: '阿尔法', unread: 1 },
    { id: 'demo1@chatroom', title: '演示群' },
  ],
  contacts: [
    { username: 'wxid_alpha', nickname: 'Alpha', remark: '阿尔法' },
    { username: 'wxid_beta', nickname: 'Beta' },
  ],
  groupMembers: { 'demo1@chatroom': ['wxid_alpha', 'wxid_beta', 'wxid_ghost'] },
  messages: [
    { id: 'm1', sessionId: 'wxid_alpha', seq: 1, createdAt: 1_700_000_000_000, senderId: 'wxid_alpha', text: '第一条' },
    { id: 'm2', sessionId: 'wxid_alpha', seq: 2, createdAt: 1_700_000_060_000, senderId: 'wxid_demo_self', isSelf: true, text: '第二条' },
    { id: 'm3', sessionId: 'wxid_alpha', seq: 3, createdAt: 1_700_000_120_000, senderId: 'wxid_alpha', kind: 'image', text: '', media: { kind: 'image', path: 'img/a.jpg' } },
    { id: 'g1', sessionId: 'demo1@chatroom', seq: 1, createdAt: 1_700_000_000_000, senderId: 'wxid_beta', senderName: 'Beta', text: '群消息' },
  ],
}

let dir: string
let path: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-demo-'))
  path = join(dir, 'fixture.json')
  writeFileSync(path, JSON.stringify(fixture), 'utf8')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('fixture schema', () => {
  it('validates and derives kinds / anchors / previews', () => {
    expect(FixtureSchema.safeParse(fixture).success).toBe(true)
    const fx = normaliseFixture(fixture, '/base')
    expect(fx.sessions.find((s) => s.id === 'demo1@chatroom')?.kind).toBe('group')
    expect(fx.sessions.find((s) => s.id === 'demo1@chatroom')?.memberCount).toBe(3)
    const alpha = fx.sessions.find((s) => s.id === 'wxid_alpha')
    expect(alpha?.kind).toBe('dm')
    expect(alpha?.lastPreview).toBe('[图片]')
    expect(alpha?.lastMessageAt).toBe(1_700_000_120_000)
    expect(fx.messages[0]?.anchor).toEqual({ sessionId: 'demo1@chatroom', messageId: 'g1', seq: 1, createdAt: 1_700_000_000_000 })
    expect(fx.messages.find((m) => m.id === 'm3')?.media?.path).toBe('/base/img/a.jpg')
    expect(fx.contacts[1]?.kind).toBe('friend')
    expect(() => normaliseFixture({ version: 2 }, '/base')).toThrow(/演示数据格式错误/)
  })
})

describe('DemoSourceReader', () => {
  it('reads lazily and pages by seq', async () => {
    const src = createDemoSourceReader({ fixturePath: path })
    expect(src.kind).toBe('demo')
    expect(src.isOpen()).toBe(false)
    await expect(src.sessions()).rejects.toThrow()
    await src.open({ dbRoot: dir, wxid: 'wxid_demo_self', dbKeyHex: '', cacheDir: dir })
    expect(src.isOpen()).toBe(true)
    expect((await src.account()).wxid).toBe('wxid_demo_self')
    expect((await src.sessions()).map((s) => s.id).sort()).toEqual(['demo1@chatroom', 'wxid_alpha'])
    expect((await src.contacts())).toHaveLength(2)
    const members = await src.groupMembers('demo1@chatroom')
    expect(members.map((m) => m.username)).toEqual(['wxid_alpha', 'wxid_beta', 'wxid_ghost'])
    expect(members[2]?.kind).toBe('stranger')

    expect((await src.messagesAfter('wxid_alpha', 0, 2)).map((m) => m.seq)).toEqual([1, 2])
    expect((await src.messagesAfter('wxid_alpha', 2, 10)).map((m) => m.seq)).toEqual([3])
    expect((await src.messagesAfter('wxid_alpha', 3, 10))).toEqual([])
    expect((await src.messagesBefore('wxid_alpha', 3, 10)).map((m) => m.seq)).toEqual([2, 1])
    expect((await src.messagesBefore('wxid_alpha', 1, 10))).toEqual([])
    expect((await src.messagesAfter('unknown', 0, 10))).toEqual([])

    const m3 = (await src.messagesAfter('wxid_alpha', 2, 1))[0]!
    expect((await src.resolveMedia(m3))?.path).toBe(join(dir, 'img/a.jpg'))
    expect(typeof src.watch(() => {})).toBe('function')
    await src.close()
    expect(src.isOpen()).toBe(false)
  })

  it('answers SELECT-only SQL over an in-memory copy', async () => {
    const src = createDemoSourceReader({ fixturePath: path })
    await src.open({ dbRoot: dir, wxid: 'wxid_demo_self', dbKeyHex: '', cacheDir: dir })
    const r = await src.querySql!('message', 'SELECT session_id, COUNT(*) AS c FROM messages GROUP BY session_id ORDER BY c DESC', 10)
    expect(r.columns).toEqual(['session_id', 'c'])
    expect(r.rows).toEqual([['wxid_alpha', 3], ['demo1@chatroom', 1]])
    await expect(src.querySql!('message', 'DELETE FROM messages', 10)).rejects.toThrow()
    await expect(src.querySql!('message', 'SELECT * FROM nope', 10)).rejects.toThrow(/SQL 执行失败/)
    const limited = await src.querySql!('message', 'SELECT id FROM messages ORDER BY created_at', 2)
    expect(limited.rows).toHaveLength(2)
    await src.close()
  })

  it('reports invalid files as SubstrateError', async () => {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{not json', 'utf8')
    const src = createDemoSourceReader({ fixturePath: bad })
    await expect(src.open({ dbRoot: dir, wxid: 'x', dbKeyHex: '', cacheDir: dir })).rejects.toMatchObject({ code: 'fixture_invalid' })
    const missing = createDemoSourceReader({ fixturePath: join(dir, 'missing.json') })
    await expect(missing.open({ dbRoot: dir, wxid: 'x', dbKeyHex: '', cacheDir: dir })).rejects.toMatchObject({ code: 'io' })
  })
})
