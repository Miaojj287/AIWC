import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext, ToolDefinition, ToolProfile } from '@aiwc/protocol'
import { asCallId, asThreadId, asTurnId, newStepId } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { createRelationshipStore } from '../relationship/relationshipStore'
import { createMemoryStore } from '../store/memoryStore'
import { createFakeSubstrate, sampleProfile } from '../testing/fakes'
import { memoryTools } from './memoryTools'
import { relationshipTools } from './relationshipTools'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aiwc-${p}-`))

function ctxFor<S extends Record<string, unknown>>(services: S, over: Partial<ToolContext<S>> = {}): ToolContext<S> {
  return {
    threadId: asThreadId('thr_t'),
    turnId: asTurnId('trn_t'),
    stepId: newStepId(),
    callId: asCallId('cal_t'),
    channel: 'desktop',
    profile: 'desktop-chat',
    signal: new AbortController().signal,
    services,
    progress: () => {},
    depth: 0,
    ...over,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byName = (tools: ToolDefinition<any, any>[], name: string) => {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(name)
  return t
}

describe('memoryTools', () => {
  const tools = memoryTools()

  it('declares risk / profiles per contract', () => {
    const spec = Object.fromEntries(tools.map((t) => [t.name, { risk: t.risk, profiles: [...t.profiles] as ToolProfile[], parallelSafe: t.parallelSafe }]))
    expect(spec).toEqual({
      remember: { risk: 'write', profiles: ['desktop-chat', 'cron'], parallelSafe: false },
      recall: { risk: 'read', profiles: ['desktop-chat', 'cron', 'subagent'], parallelSafe: true },
      forget: { risk: 'destructive', profiles: ['desktop-chat'], parallelSafe: false },
      list_memories: { risk: 'read', profiles: ['desktop-chat', 'cron'], parallelSafe: true },
    })
    expect(byName(tools, 'remember').inputSchema.safeParse({ file: 'SOUL', text: 'x' }).success).toBe(false)
    expect(byName(tools, 'remember').summarize?.({ file: 'USER', text: '喜欢咖啡' })).toBe('写入 USER：喜欢咖啡')
  })

  it('remember → list → recall → forget through execute()', async () => {
    const memory = createMemoryStore({ dir: tmp('mem'), limits: { MEMORY: 40 } })
    const ctx = ctxFor({ memory })
    const remember = byName(tools, 'remember')
    const r1 = await remember.execute({ file: 'MEMORY', text: '用户常驻北京' }, ctx)
    expect(r1.isError).toBeUndefined()
    expect(String(r1.content)).toContain('已写入 MEMORY')
    expect(String((await remember.execute({ file: 'MEMORY', text: '用户常驻北京。' }, ctx)).content)).toContain('无需重复')
    const over = await remember.execute({ file: 'MEMORY', text: '这是一条肯定会超出四十字预算的很长很长很长很长很长很长很长很长很长很长的记忆内容' }, ctx)
    expect(over.isError).toBe(true)
    expect(String(over.content)).toContain('空间不足')
    expect(String(over.content)).toContain('[0] 用户常驻北京')

    const listed = await byName(tools, 'list_memories').execute({ file: 'MEMORY' }, ctx)
    expect(String(listed.content)).toContain('[0] 用户常驻北京')
    expect(String(listed.content)).toMatch(/MEMORY 已用 \d+%/)
    expect(String((await byName(tools, 'list_memories').execute({ file: 'SOUL' }, ctx)).content)).toContain('目前为空')

    const recall = byName(tools, 'recall')
    expect(String((await recall.execute({ query: '北京' }, ctx)).content)).toContain('[MEMORY #0] 用户常驻北京')
    expect(String((await recall.execute({ query: '上海' }, ctx)).content)).toContain('没有与「上海」相关的记忆')

    const forget = byName(tools, 'forget')
    const miss = await forget.execute({ file: 'MEMORY', index: 3 }, ctx)
    expect(miss.isError).toBe(true)
    expect(forget.summarize?.({ file: 'MEMORY', index: 0 })).toBe('删除 MEMORY 第 0 条记忆')
    const gone = await forget.execute({ file: 'MEMORY', index: 0 }, ctx)
    expect(String(gone.content)).toContain('已删除 MEMORY 第 0 条')
    expect(await memory.entries('MEMORY')).toEqual([])
  })
})

describe('relationshipTools', () => {
  it('reads a profile, reports status when absent, and restricts the bot to its own chat', async () => {
    const relationships = createRelationshipStore({ dir: tmp('rel') })
    const substrate = createFakeSubstrate({ sessions: [], messages: [], contacts: [{ username: 'wxid_x', nickname: '小明', kind: 'friend' }] })
    const tool = byName(relationshipTools(), 'get_relationship_profile')
    expect(tool.risk).toBe('read')
    expect([...tool.profiles]).toEqual(['desktop-chat', 'wechat-bot', 'cron'])
    const ctx = ctxFor({ relationships, substrate })
    expect(String((await tool.execute({ contactId: 'wxid_x' }, ctx)).content)).toBe('「小明」（wxid_x）尚未克隆。')
    await relationships.upsert(sampleProfile())
    const text = String((await tool.execute({ contactId: 'wxid_test01' }, ctx)).content)
    expect(text).toContain('「李娜」（wxid_test01）画像 v1，2 组样本')
    expect(text).toContain('边界：不聊前任')
    expect(text).toContain('共同经历：2024 夏 一起去青岛')
    const bot = ctxFor({ relationships, substrate }, { profile: 'wechat-bot', channel: 'wechat-ilink', origin: { channel: 'wechat-ilink', chatId: 'someone_else' } })
    expect((await tool.execute({ contactId: 'wxid_test01' }, bot)).isError).toBe(true)
    const botOwn = ctxFor({ relationships, substrate }, { profile: 'wechat-bot', channel: 'wechat-ilink', origin: { channel: 'wechat-ilink', chatId: 'wxid_test01' } })
    expect((await tool.execute({ contactId: 'wxid_test01' }, botOwn)).isError).toBeUndefined()
  })
})
