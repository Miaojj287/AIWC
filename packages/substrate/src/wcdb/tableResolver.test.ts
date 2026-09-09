import { describe, expect, it } from 'vitest'
import { MessageTableIndex, extractMessageTableHash, messageTableHash } from './tableResolver'
import type { MessageShard } from './dbFiles'
import type { WcdbQuery } from './query'
import type { Row } from './rowDecoders'

describe('message table hashing', () => {
  it('hashes and extracts session table names', () => {
    const hash = messageTableHash('wxid_friend')
    expect(hash).toMatch(/^[0-9a-f]{32}$/)
    expect(extractMessageTableHash(`Msg_${hash}`)).toBe(hash)
    expect(extractMessageTableHash(`Msg_${hash}_1`)).toBe(hash)
    expect(extractMessageTableHash(`Msg_${hash}garbage`)).toBeNull()
    expect(extractMessageTableHash('Name2Id')).toBeNull()
  })
})

/** Minimal in-memory WcdbQuery backed by fixtures keyed on dbPath. */
function fakeQuery(tablesByDb: Record<string, string[]>, columns: Record<string, Row[]>): WcdbQuery {
  return {
    all: (dbPath, sql) => {
      if (/sqlite_master/i.test(sql)) return (tablesByDb[dbPath] ?? []).map((name) => ({ name }))
      if (/table_info/i.test(sql)) return columns[dbPath] ?? []
      if (/sort_seq IS NULL/i.test(sql)) return [{ c: 0 }]
      if (/Name2Id WHERE user_name/i.test(sql)) return [{ rid: 42 }]
      return []
    },
    get: (dbPath, sql, params) => fakeQuery(tablesByDb, columns).all(dbPath, sql, params)[0],
    tableExists: (dbPath, tableName) => (tablesByDb[dbPath] ?? []).some((n) => n.toLowerCase() === tableName.toLowerCase()),
    columns: (dbPath) => (columns[dbPath] ?? []).map((r) => String(r['name'])),
    tables: (dbPath, like) => {
      const names = tablesByDb[dbPath] ?? []
      if (!like) return names
      const re = new RegExp('^' + like.replace(/%/g, '.*') + '$', 'i')
      return names.filter((n) => re.test(n))
    },
  }
}

describe('MessageTableIndex', () => {
  const hash = messageTableHash('wxid_friend')
  const dbA = '/db/message_0.db'
  const dbB = '/db/message_1.db'
  const shards: MessageShard[] = [
    { dbPath: dbA, kind: 'message' },
    { dbPath: dbB, kind: 'message' },
  ]
  const q = fakeQuery(
    {
      [dbA]: [`Msg_${hash}`, 'Name2Id'],
      [dbB]: ['Msg_deadbeefdeadbeefdeadbeefdeadbeef'],
    },
    {
      [dbA]: [{ name: 'local_id' }, { name: 'create_time' }, { name: 'sort_seq' }, { name: 'real_sender_id' }, { name: 'server_id' }],
    },
  )

  it('finds every shard holding the session table', () => {
    const index = new MessageTableIndex(q, () => shards)
    const refs = index.tablesFor('wxid_friend')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.dbPath).toBe(dbA)
    expect(refs[0]?.tableName).toBe(`Msg_${hash}`)
  })

  it('reports column shape and Name2Id', () => {
    const index = new MessageTableIndex(q, () => shards)
    const ref = index.tablesFor('wxid_friend')[0]!
    const cols = index.columns(ref)
    expect(cols.hasSortSeq).toBe(true)
    expect(cols.sortSeqAllPositive).toBe(true)
    expect(cols.hasRealSenderId).toBe(true)
    expect(index.hasName2Id(dbA)).toBe(true)
    expect(index.myRowId(dbA, ['wxid_me'])).toBe(42)
  })

  it('honours a TTL clock for rescanning', () => {
    let now = 0
    const index = new MessageTableIndex(q, () => shards, () => now)
    expect(index.tablesFor('wxid_friend')).toHaveLength(1)
    index.invalidate()
    now = 1
    expect(index.tablesFor('wxid_friend')).toHaveLength(1)
  })
})

it('keeps multiple tables for the same conversation in one shard', () => {
  const hash = messageTableHash('Tencent-Games')
  const names = [`Msg_${hash}`, `Msg_${hash}_1`]
  const q = fakeQuery({ '/biz.db': names }, {})
  const index = new MessageTableIndex(q, () => [{ dbPath: '/biz.db', kind: 'biz_message' }])
  expect(index.tablesFor('Tencent-Games').map((ref) => ref.tableName)).toEqual(names)
})
