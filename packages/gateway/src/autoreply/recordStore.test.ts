import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AutoReplyRecord, AutoReplyRule, ReplyDraft } from '@aiwc/protocol'
import { createAutoReplyRecordStore } from './recordStore'

const rule = (sessionId: string, over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: `r_${sessionId}`,
  sessionId,
  enabled: true,
  source: 'ai',
  prompt: '简洁礼貌',
  historyCount: 30,
  updatedAt: 1000,
  ...over,
})

const record = (id: string, sessionId: string, at: number, status: AutoReplyRecord['status'] = 'sent'): AutoReplyRecord => ({
  id,
  ruleId: `r_${sessionId}`,
  sessionId,
  triggerMessage: { id: `t_${id}`, text: '报价?', at },
  replyText: '收到',
  at,
  status,
})

describe('createAutoReplyRecordStore', () => {
  it('rules: one per session, upsert by session, enable toggle, delete, derived todayCount', () => {
    const store = createAutoReplyRecordStore({ dbPath: ':memory:' })
    store.saveRule(rule('s1'))
    store.saveRule(rule('s2', { enabled: false, updatedAt: 2000 }))
    expect(store.listRules().map((r) => r.sessionId)).toEqual(['s2', 's1'])
    expect(store.getRule('s1')?.prompt).toBe('简洁礼貌')
    expect(store.getRule('s1')?.todayCount).toBe(0)
    expect(store.getRuleById('r_s2')?.enabled).toBe(false)

    // same session, new id → replaces, still one rule for s1
    store.saveRule(rule('s1', { id: 'r_s1_v2', prompt: '发票问题转人工', updatedAt: 3000 }))
    expect(store.listRules().filter((r) => r.sessionId === 's1')).toHaveLength(1)
    expect(store.getRule('s1')?.id).toBe('r_s1_v2')
    expect(store.getRuleById('r_s1')).toBeUndefined()

    store.setEnabled('s2', true)
    expect(store.getRule('s2')?.enabled).toBe(true)
    store.setEnabled('nope', true)

    const now = Date.now()
    store.addRecord(record('a', 's1', now - 60_000))
    store.addRecord(record('b', 's1', now - 30_000, 'failed'))
    expect(store.getRule('s1')?.todayCount).toBe(1)

    store.deleteRule('s1')
    expect(store.getRule('s1')).toBeUndefined()
    expect(store.listRules()).toHaveLength(1)
    store.close()
  })

  it('does not persist derived fields', () => {
    const store = createAutoReplyRecordStore({ dbPath: ':memory:' })
    store.saveRule({ ...rule('s1'), todayCount: 99 })
    expect(store.getRuleById('r_s1')).not.toHaveProperty('todayCount')
    store.close()
  })

  it('records: newest first, filters by session / status, limit, update, countToday since local midnight', () => {
    const store = createAutoReplyRecordStore({ dbPath: ':memory:' })
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const today = midnight.getTime() + 60_000
    store.addRecord(record('r1', 's1', today))
    store.addRecord(record('r2', 's1', today + 1000, 'pending'))
    store.addRecord(record('r3', 's2', today + 2000))
    store.addRecord(record('r4', 's1', midnight.getTime() - 1000)) // yesterday

    expect(store.listRecords().map((r) => r.id)).toEqual(['r3', 'r2', 'r1', 'r4'])
    expect(store.listRecords({ sessionId: 's1' }).map((r) => r.id)).toEqual(['r2', 'r1', 'r4'])
    expect(store.listRecords({ status: 'pending' }).map((r) => r.id)).toEqual(['r2'])
    expect(store.listRecords({ sessionId: 's1', status: 'sent', limit: 1 }).map((r) => r.id)).toEqual(['r1'])
    expect(store.countToday('s1', today + 5000)).toBe(1)

    const updated = store.updateRecord('r2', { status: 'sent', replyText: '好的', recallableUntil: today + 120_000 })
    expect(updated).toMatchObject({ id: 'r2', status: 'sent', replyText: '好的', recallableUntil: today + 120_000 })
    expect(store.getRecord('r2')?.status).toBe('sent')
    expect(store.countToday('s1', today + 5000)).toBe(2)
    expect(store.updateRecord('missing', { status: 'sent' })).toBeUndefined()
    store.close()
  })

  it('drafts: upsert, list by state, delete', () => {
    const store = createAutoReplyRecordStore({ dbPath: ':memory:' })
    const draft: ReplyDraft = {
      id: 'd1',
      ruleId: 'r_s1',
      source: { channel: 'wechat-ilink', peerId: 'u', chatId: 'u', chatType: 'dm' },
      triggerMessageId: 'm1',
      triggerText: 'hi',
      draft: '你好',
      state: 'pending',
      createdAt: 10,
      mode: 'confirm',
    }
    store.saveDraft(draft)
    store.saveDraft({ ...draft, id: 'd2', createdAt: 20, state: 'sent' })
    expect(store.listDrafts().map((d) => d.id)).toEqual(['d2', 'd1'])
    expect(store.listDrafts(['pending']).map((d) => d.id)).toEqual(['d1'])
    store.saveDraft({ ...draft, state: 'rejected' })
    expect(store.getDraft('d1')?.state).toBe('rejected')
    store.deleteDraft('d1')
    expect(store.getDraft('d1')).toBeUndefined()
    store.close()
  })

  it('persists to a file and reopens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ar-store-'))
    const dbPath = join(dir, 'nested', 'autoreply.db')
    try {
      const a = createAutoReplyRecordStore({ dbPath })
      a.saveRule(rule('s1'))
      a.addRecord(record('r1', 's1', 5))
      a.close()
      const b = createAutoReplyRecordStore({ dbPath })
      expect(b.getRule('s1')?.id).toBe('r_s1')
      expect(b.getRecord('r1')?.replyText).toBe('收到')
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
