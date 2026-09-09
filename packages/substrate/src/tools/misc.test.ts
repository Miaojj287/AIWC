import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { substrateTools } from './index'
import { assertReadOnlySql, querySql, sanitizeCell } from './querySql'
import { body, runTool } from './testing/ctx'
import { sampleWorld } from './testing/fakeSubstrate'
import { transcribeVoiceMessage } from './transcribeVoiceMessage'

describe('transcribe_voice_message', () => {
  it('is unavailable when the substrate has no transcriber', async () => {
    const sub = sampleWorld()
    const res = await runTool(transcribeVoiceMessage, { sessionId: 'user_a', messageId: 'm3' }, sub)
    expect(res.isError).toBe(true)
    expect(body(res).error).toContain('语音转文字')
  })
  it('transcribes a voice message through the substrate and reports progress', async () => {
    const transcribe = vi.fn(async () => '周五七点老地方')
    const sub = sampleWorld({ transcribe })
    const progress = vi.fn()
    const res = await runTool(transcribeVoiceMessage, { sessionId: 'user_a', messageId: 'm3' }, sub, { progress })
    expect(res.isError).toBeUndefined()
    const out = body(res)
    expect(out.text).toBe('周五七点老地方')
    expect(out.cached).toBe(false)
    expect(out.anchor).toMatchObject({ sessionId: 'user_a', messageId: 'm3', seq: 3 })
    expect(out.sender).toBe('阿明')
    expect(out.durationMs).toBe(4200)
    expect(transcribe).toHaveBeenCalledWith('user_a', 'm3', { force: false })
    expect(progress).toHaveBeenCalled()
    expect(res.meta?.anchors).toHaveLength(1)
  })
  it('reuses an existing transcript unless force=true', async () => {
    const transcribe = vi.fn(async () => 'fresh')
    const sub = sampleWorld({ transcribe })
    const m3 = sub.data.messages.find((m) => m.id === 'm3')!
    m3.media = { kind: 'voice', durationMs: 4200, transcript: 'cached text' }
    const cached = body(await runTool(transcribeVoiceMessage, { sessionId: 'user_a', messageId: 'm3' }, sub))
    expect(cached).toMatchObject({ text: 'cached text', cached: true })
    expect(transcribe).not.toHaveBeenCalled()
    const forced = body(await runTool(transcribeVoiceMessage, { sessionId: 'user_a', messageId: 'm3', force: true }, sub))
    expect(forced.text).toBe('fresh')
    expect(transcribe).toHaveBeenCalledWith('user_a', 'm3', { force: true })
  })
  it('refuses non-voice or unknown messages without calling STT', async () => {
    const transcribe = vi.fn(async () => 'x')
    const sub = sampleWorld({ transcribe })
    expect((await runTool(transcribeVoiceMessage, { sessionId: 'user_a', messageId: 'm1' }, sub)).isError).toBe(true)
    expect((await runTool(transcribeVoiceMessage, { sessionId: 'user_a', messageId: 'zz' }, sub)).isError).toBe(true)
    expect(transcribe).not.toHaveBeenCalled()
  })
  it('is not offered to the bot / plan profiles and is not parallel-safe', () => {
    expect(transcribeVoiceMessage.profiles).toEqual(['desktop-chat', 'cron', 'subagent'])
    expect(transcribeVoiceMessage.parallelSafe).toBe(false)
    expect(transcribeVoiceMessage.risk).toBe('read')
    expect(transcribeVoiceMessage.inputSchema.safeParse({ sessionId: 'a' }).success).toBe(false)
    expect(transcribeVoiceMessage.inputSchema.safeParse({ sessionId: 'a', messageId: 'b' }).success).toBe(true)
  })
})

describe('query_sql', () => {
  const audit = { reason: '需要跨表统计', attemptedTools: ['chat_stats'], whyStructuredToolsInsufficient: 'chat_stats 不支持按月+按人交叉' }

  it('reports unavailability when the substrate exposes no querySql', async () => {
    const sub = sampleWorld()
    const res = await runTool(querySql, { db: 'message', sql: 'SELECT 1', ...audit }, sub)
    expect(res.isError).toBe(true)
    expect(body(res).error).toContain('不可用')
    expect(body(res).audit).toEqual(audit)
  })
  it('forwards a validated SELECT and sanitizes cells', async () => {
    const sql = vi.fn(async () => ({ columns: ['id', 'blob', 'long'], rows: [[1, new Uint8Array([1, 2, 3]), 'x'.repeat(600)], [2, null, 'ok']] }))
    const sub = sampleWorld({ querySql: sql })
    const res = await runTool(querySql, { db: 'contact', sql: 'SELECT id FROM contact;', limit: 10, ...audit }, sub)
    expect(res.isError).toBeUndefined()
    expect(sql).toHaveBeenCalledWith({ db: 'contact', sql: 'SELECT id FROM contact', limit: 10 })
    const out = body(res)
    expect(out.columns).toEqual(['id', 'blob', 'long'])
    expect(out.rowCount).toBe(2)
    expect(out.rows[0][1]).toBe('[blob]')
    expect(out.rows[0][2]).toHaveLength(501)
    expect(out.rows[1]).toEqual([2, null, 'ok'])
    expect(out.truncated).toBe(false)
    expect(out.audit).toEqual(audit)
  })
  it('rejects non read-only SQL before touching the substrate', async () => {
    const sql = vi.fn(async () => ({ columns: [], rows: [] }))
    const sub = sampleWorld({ querySql: sql })
    for (const bad of ['DROP TABLE contact', 'SELECT 1; SELECT 2', 'UPDATE contact SET remark = 1', 'PRAGMA journal_mode', 'WITH x AS (SELECT 1) DELETE FROM contact']) {
      const res = await runTool(querySql, { db: 'contact', sql: bad, ...audit }, sub)
      expect(res.isError, bad).toBe(true)
    }
    expect(sql).not.toHaveBeenCalled()
    expect((await runTool(querySql, { db: 'contact', sql: 'PRAGMA table_info("contact")', ...audit }, sub)).isError).toBeUndefined()
    expect((await runTool(querySql, { db: 'contact', sql: 'explain select 1', ...audit }, sub)).isError).toBeUndefined()
  })
  it('requires non-empty audit fields via the schema', () => {
    const s = querySql.inputSchema
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1' }).success).toBe(false)
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1', ...audit, reason: '  ' }).success).toBe(false)
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1', ...audit, attemptedTools: [] }).success).toBe(false)
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1', ...audit, attemptedTools: [' '] }).success).toBe(false)
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1', ...audit, whyStructuredToolsInsufficient: '' }).success).toBe(false)
    expect(s.safeParse({ db: 'other', sql: 'SELECT 1', ...audit }).success).toBe(false)
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1', ...audit, limit: 501 }).success).toBe(false)
    expect(s.safeParse({ db: 'message', sql: 'SELECT 1', ...audit }).success).toBe(true)
  })
  it('is desktop-chat / subagent only and serial', () => {
    expect(querySql.profiles).toEqual(['desktop-chat', 'subagent'])
    expect(querySql.parallelSafe).toBe(false)
    expect(querySql.risk).toBe('read')
  })
  it('assertReadOnlySql / sanitizeCell helpers', () => {
    expect(assertReadOnlySql('  select 1 ; ')).toBe('select 1')
    expect(() => assertReadOnlySql('')).toThrow()
    expect(() => assertReadOnlySql('INSERT INTO t VALUES (1)')).toThrow()
    expect(sanitizeCell(undefined)).toBeNull()
    expect(sanitizeCell(10n)).toBe('10')
    expect(sanitizeCell({ a: 1 })).toBe('{"a":1}')
  })
})

describe('substrateTools()', () => {
  const tools = substrateTools()

  it('exports the promised 13 read-only tools with unique valid names', () => {
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.sort()).toEqual(
      [
        'chat_stats',
        'get_context',
        'get_timeline',
        'group_member_ranking',
        'group_members',
        'list_contacts',
        'list_groups',
        'list_sessions',
        'query_sql',
        'search_media',
        'search_messages',
        'semantic_search',
        'transcribe_voice_message',
      ].sort(),
    )
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{1,63}$/)
      expect(t.risk).toBe('read')
      expect(t.description.split('\n').length).toBeGreaterThanOrEqual(2)
      expect(t.description).toMatch(/[一-鿿]/)
    }
  })
  it('mounts only origin-scopable tools on the bot profile; everything else is parallel-safe', () => {
    const bot = tools.filter((t) => t.profiles.includes('wechat-bot')).map((t) => t.name).sort()
    // Enumeration / cross-session scans, SQL and STT are never offered to the bot (its replies reach the peer).
    expect(bot).toEqual(['chat_stats', 'get_context', 'get_timeline', 'group_member_ranking', 'group_members', 'search_messages', 'semantic_search'])
    for (const name of ['list_sessions', 'list_contacts', 'list_groups', 'search_media', 'query_sql', 'transcribe_voice_message']) {
      expect(bot, name).not.toContain(name)
    }
    const serial = tools.filter((t) => !t.parallelSafe).map((t) => t.name).sort()
    expect(serial).toEqual(['query_sql', 'transcribe_voice_message'])
    expect(tools.filter((t) => t.profiles.includes('cron')).map((t) => t.name)).not.toContain('query_sql')
  })
  it('every input schema converts to JSON schema (what the kernel sends to the model)', () => {
    for (const t of tools) {
      const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { type?: string; properties?: Record<string, unknown> }
      expect(json.type, t.name).toBe('object')
      expect(Object.keys(json.properties ?? {}).length, t.name).toBeGreaterThan(0)
    }
  })
  it('summaries are one-liners', () => {
    const sample: Record<string, unknown> = {
      list_sessions: { query: 'a', limit: 5 },
      list_contacts: { query: 'a' },
      search_messages: { query: 'a', limit: 5 },
      semantic_search: { query: 'a' },
      get_context: { anchor: { sessionId: 's', messageId: 'm', seq: 1, createdAt: 1 }, radius: 3 },
      get_timeline: { sessionId: 's', limit: 5 },
      chat_stats: { metric: 'overview' },
      list_groups: { limit: 5 },
      group_members: { groupId: 'g' },
      group_member_ranking: { groupId: 'g' },
      transcribe_voice_message: { sessionId: 's', messageId: 'm' },
      search_media: { kind: 'image' },
      query_sql: { db: 'message', sql: 'SELECT 1' },
    }
    for (const t of tools) {
      const line = t.summarize?.(sample[t.name])
      expect(line, t.name).toBeTypeOf('string')
      expect(line, t.name).not.toContain('\n')
    }
  })
})
