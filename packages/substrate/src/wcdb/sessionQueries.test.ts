import { describe, expect, it, vi } from 'vitest'
import { ContactDirectory } from './contactQueries'
import type { WcdbQuery } from './query'
import type { Row } from './rowDecoders'
import { querySessions } from './sessionQueries'

function queryFixture(sessionRows: Row[], contactRows: Row[]) {
  const sqlLog: string[] = []
  const q: WcdbQuery = {
    all: (db, sql, params = []) => {
      sqlLog.push(`${db}:${sql}`)
      if (db === 'sessions') {
        const offset = Number(params[0] ?? 0)
        return sessionRows.slice(offset, offset + 500)
      }
      if (/WHERE username IN/.test(sql)) {
        const wanted = new Set(params.map(String))
        return contactRows.filter((row) => wanted.has(String(row.username)))
      }
      return []
    },
    get: () => undefined,
    tableExists: (db, table) => db === 'contacts' && table === 'contact',
    columns: () => ['username', 'remark', 'nick_name', 'alias', 'flag', 'big_head_url', 'small_head_url'],
    tables: (db) => (db === 'sessions' ? ['SessionTable'] : ['contact']),
  }
  return { q, sqlLog }
}

describe('fast session discovery', () => {
  it('publishes the first complete page before scanning the rest and only fetches matching contacts', async () => {
    const sessions = Array.from({ length: 501 }, (_, i) => ({
      username: `wxid_${i}`,
      sort_timestamp: 10_000 - i,
      summary: `message ${i}`,
    }))
    const contacts = sessions.map((row, i) => ({
      username: row.username,
      remark: `Contact ${i}`,
      flag: 0,
    }))
    const { q, sqlLog } = queryFixture(sessions, contacts)
    const directory = new ContactDirectory(q, 'contacts')
    const pages: number[] = []
    const yieldEvery = vi.fn(async () => {
      expect(pages).toEqual([500])
    })

    const result = await querySessions(
      { q, sessionDbPath: 'sessions', contacts: directory },
      yieldEvery,
      (page) => pages.push(page.length),
    )

    expect(pages).toEqual([500, 1])
    expect(result).toHaveLength(501)
    expect(result[0]).toMatchObject({ title: 'Contact 0', id: 'wxid_0' })
    expect(yieldEvery).toHaveBeenCalledOnce()
    expect(sqlLog.some((sql) => /rowid >/.test(sql))).toBe(false)
    expect(sqlLog.some((sql) => /GROUP BY m\.room_id/.test(sql))).toBe(false)
  })

  it('looks up one account contact without loading the entire contact table', () => {
    const { q, sqlLog } = queryFixture([], [{ username: 'wxid_me', nick_name: 'Me', flag: 0 }])
    const directory = new ContactDirectory(q, 'contacts')

    expect(directory.get('wxid_me')?.nickname).toBe('Me')
    expect(directory.get('missing')).toBeUndefined()
    expect(directory.get('missing')).toBeUndefined()
    expect(sqlLog.filter((sql) => /WHERE username IN/.test(sql))).toHaveLength(2)
    expect(sqlLog.some((sql) => /rowid >/.test(sql))).toBe(false)
  })
})
