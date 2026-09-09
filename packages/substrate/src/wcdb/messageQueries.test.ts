import { expect, it } from 'vitest'
import { findMessageRow, type MessageQueryContext } from './messageQueries'
import { MessageTableIndex, messageTableHash } from './tableResolver'
import type { WcdbQuery } from './query'
it('does not resolve media from a different shard merely because the local id matches', () => {
  const q: WcdbQuery = {
    tables: () => [`Msg_${messageTableHash('s')}`],
    columns: () => ['local_id', 'sort_seq', 'create_time'],
    tableExists: () => false,
    get: () => ({ c: 0 }),
    all: (db, sql) => sql.includes('m.local_id') ? [{ local_id: 125, sort_seq: db === '/old' ? 10 : 20, create_time: 1 }] : [],
  }
  const index = new MessageTableIndex(q, () => [{ dbPath: '/old', kind: 'message' }, { dbPath: '/new', kind: 'message' }])
  const ctx: MessageQueryContext = { q, index, selfWxid: 'me', selfKeys: ['me'], resolveName: () => undefined }
  expect(findMessageRow(ctx, 's', 'wx:125:20')?.ref.dbPath).toBe('/new')
  expect(findMessageRow(ctx, 's', '125', 20)?.ref.dbPath).toBe('/new')
})
