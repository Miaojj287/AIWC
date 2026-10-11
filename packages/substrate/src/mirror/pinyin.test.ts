import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WxSession } from '@aiwc/protocol'
import { createMirror, type Mirror } from './index'
import { pinyinQuery, pinyinSearchKey } from './pinyin'
import { openMirrorDb } from './schema'

const session = (id: string, kind: WxSession['kind'], title: string): WxSession => ({
  id,
  kind,
  title,
  unread: 0,
  pinned: false,
  muted: false,
})

const mirrors: Mirror[] = []
const dirs: string[] = []
afterEach(() => {
  while (mirrors.length) mirrors.pop()?.close()
  while (dirs.length) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

describe('pinyinSearchKey', () => {
  it('holds the full reading and the initials', () => {
    expect(pinyinSearchKey('张三').split(' ')).toEqual(['zhangsan', 'zs'])
    expect(pinyinSearchKey('产品群').split(' ')).toContain('cpq')
  })

  it('adds the initials of every reading of a polyphone', () => {
    const words = pinyinSearchKey('重庆群').split(' ')
    expect(words[0]).toBe('chongqingqun')
    expect(words).toEqual(expect.arrayContaining(['cqq', 'zqq']))
  })

  it('keeps ASCII letters and digits in place and skips everything else', () => {
    expect(pinyinSearchKey('A组2号😀').split(' ')).toEqual(['azu2hao', 'az2h'])
  })

  it('is empty for names without a Han character', () => {
    expect(pinyinSearchKey('Alice', undefined, null, '')).toBe('')
  })

  it('caps the polyphone variants', () => {
    expect(pinyinSearchKey('行行行行行行行行').split(' ').length).toBeLessThanOrEqual(9)
  })

  it('combines several names of one row', () => {
    expect(pinyinSearchKey('老张', '张三').split(' ')).toEqual(expect.arrayContaining(['lz', 'zs']))
  })
})

describe('pinyinQuery', () => {
  it('accepts letters (and digits after a letter), drops @ / spaces / apostrophes', () => {
    expect(pinyinQuery('@ZS')).toBe('zs')
    expect(pinyinQuery("xi'an")).toBe('xian')
    expect(pinyinQuery('zhang san')).toBe('zhangsan')
    expect(pinyinQuery('张三')).toBeUndefined()
    expect(pinyinQuery('123')).toBeUndefined()
    expect(pinyinQuery('')).toBeUndefined()
  })
})

describe('mirror pinyin search', () => {
  it('finds chats and contacts by initials and full pinyin', () => {
    const m = createMirror({ dbPath: ':memory:' })
    mirrors.push(m)
    m.upsertSessions([session('wxid_zs', 'dm', '张三'), session('g1@chatroom', 'group', '产品群')])
    m.upsertContacts([
      { username: 'wxid_zs', nickname: 'zhang_3', remark: '张三', kind: 'friend' },
      { username: 'wxid_ls', nickname: '李四', kind: 'friend' },
    ])
    expect(m.listSessions({ query: 'cpq', limit: 10 }).items.map((s) => s.id)).toEqual(['g1@chatroom'])
    expect(m.listSessions({ query: 'zs', limit: 10 }).items.map((s) => s.id)).toEqual(['wxid_zs'])
    expect(m.listContacts({ query: 'zhangsan', limit: 10 }).items.map((c) => c.username)).toEqual(['wxid_zs'])
    expect(m.listContacts({ query: 'ls', limit: 10 }).items.map((c) => c.username)).toEqual(['wxid_ls'])
    // Plain substring search is unchanged.
    expect(m.listSessions({ query: '产品', limit: 10 }).total).toBe(1)
  })

  it('keeps the key current when a title changes', () => {
    const m = createMirror({ dbPath: ':memory:' })
    mirrors.push(m)
    m.upsertSessions([session('g1@chatroom', 'group', '产品群')])
    m.upsertSessions([session('g1@chatroom', 'group', '设计群')])
    expect(m.listSessions({ query: 'cpq', limit: 10 }).total).toBe(0)
    expect(m.listSessions({ query: 'sjq', limit: 10 }).total).toBe(1)
  })

  it('backfills rows written before the pinyin columns existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiwc-pinyin-'))
    dirs.push(dir)
    const dbPath = join(dir, 'mirror.db')
    const first = createMirror({ dbPath })
    first.upsertSessions([session('g1@chatroom', 'group', '产品群')])
    first.upsertContacts([{ username: 'wxid_zs', nickname: '张三', kind: 'friend' }])
    first.close()
    // Simulate an old mirror: the key columns hold nothing yet.
    const raw = openMirrorDb(dbPath)
    raw.exec('UPDATE sessions SET title_py = NULL; UPDATE contacts SET name_py = NULL')
    raw.close()

    const reopened = createMirror({ dbPath })
    mirrors.push(reopened)
    expect(reopened.listSessions({ query: 'cpq', limit: 10 }).total).toBe(1)
    expect(reopened.listContacts({ query: 'zs', limit: 10 }).total).toBe(1)
  })
})
