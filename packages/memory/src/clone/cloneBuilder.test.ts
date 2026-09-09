import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CloneStatus, ModelSelection, WxMessage } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { extractJson } from '../internal/model'
import { createRelationshipStore } from '../relationship/relationshipStore'
import { createFakeSubstrate, createScriptedModel, fakeMessage, fakeSession } from '../testing/fakes'
import { createCloneBuilder } from './cloneBuilder'
import { applyCorrections } from './corrections'
import { BURST_JOINER, extractPairs, mergeTurns, pickSamples, renderChunks, selectChunks } from './corpus'

import { mergeLocally, partialSchema, toCardAndDeep } from './llm'

const tmp = () => mkdtempSync(join(tmpdir(), 'aiwc-clone-'))
const CONTACT = 'wxid_lina'

/** me → her bursts, one exchange per 4 minutes; every 3rd exchange she answers with a 2-message burst. */
function chat(count: number): WxMessage[] {
  const out: WxMessage[] = []
  const base = new Date('2026-06-01T09:00:00').getTime()
  let seq = 1
  let t = base
  let i = 0
  while (out.length < count) {
    out.push(fakeMessage({ sessionId: CONTACT, seq: seq++, createdAt: t, isSelf: true, text: `我问第 ${i} 件事，${'细节'.repeat(25)}` }))
    t += 20_000
    out.push(fakeMessage({ sessionId: CONTACT, seq: seq++, createdAt: t, text: `哈哈哈 第 ${i} 件事这样啦~` }))
    if (i % 3 === 0) {
      t += 5_000
      out.push(fakeMessage({ sessionId: CONTACT, seq: seq++, createdAt: t, text: '绝了' }))
    }
    if (i % 10 === 0) {
      t += 5_000
      out.push(fakeMessage({ sessionId: CONTACT, seq: seq++, createdAt: t, kind: 'voice', media: { kind: 'voice', transcript: i % 20 === 0 ? '语音里说的' : undefined } }))
    }
    t += 4 * 60_000
    i++
  }
  return out.slice(0, count)
}

const PARTIAL = (suffix: string) =>
  JSON.stringify({
    tone: ['轻快', `爱开玩笑${suffix}`],
    traits: ['热心'],
    catchphrases: ['哈哈哈', '绝了'],
    punctuation: '爱用~，几乎不用句号',
    addressing: { self: '我', other: '老张' },
    topics: ['吃饭'],
    replyHabits: { 被问事情时: '先哈哈哈再答' },
    facts: [`在杭州做设计${suffix}`],
    relationship: '大学同学',
    reactionPatterns: ['被夸时自谦'],
    boundaries: ['不聊前任'],
    sharedEvents: [{ when: '2024 夏', what: '去青岛' }, '没时间的事件'],
  })

function setup(messages: WxMessage[], handler?: (system: string, user: string) => string) {
  const substrate = createFakeSubstrate({
    sessions: [fakeSession({ id: CONTACT, title: '李娜' })],
    messages,
    contacts: [{ username: CONTACT, nickname: '李娜', remark: '娜娜', kind: 'friend' }],
  })
  const relationships = createRelationshipStore({ dir: tmp() })
  const model = createScriptedModel(
    handler ??
      ((system) => {
        if (system.includes('人物侧写师')) return '当然，这是结果：\n```json\n' + PARTIAL(' 分块') + '\n```'
        if (system.includes('合并成一份')) return PARTIAL(' 合并')
        return '{}'
      }),
  )
  const statuses: CloneStatus[] = []
  const selections: Array<ModelSelection | undefined> = []
  const builder = createCloneBuilder({
    substrate,
    relationships,
    model: async (selection) => {
      selections.push(selection)
      return model
    },
  })
  builder.onStatus((e) => statuses.push(e.status))
  return { substrate, relationships, model, builder, statuses, selections }
}

describe('clone corpus', () => {
  it('merges bursts into turns, extracts other→subject pairs and picks ≤ 40 spread samples', () => {
    const msgs = chat(400)
    const turns = mergeTurns(msgs, false)
    expect(turns.every((t, i) => i === 0 || t.subject !== turns[i - 1]?.subject)).toBe(true)
    const pairs = extractPairs(turns)
    expect(pairs.length).toBeGreaterThan(100)
    expect(pairs.some((p) => p.replies.length > 1)).toBe(true) // burst kept message-by-message
    expect(pairs.some((p) => p.context)).toBe(true) // the turn before the prompt travels along
    const samples = pickSamples(pairs)
    expect(samples.some((s) => s.reply.includes(BURST_JOINER))).toBe(true) // bursts joined for display
    expect(samples.length).toBe(40)
    expect(samples[0]?.at).toBeLessThan(samples[39]?.at ?? 0)
    expect(samples.every((s) => s.prompt.length <= 160 && s.reply.length <= 160 * 6 + 5)).toBe(true)
    const chunks = renderChunks(turns, '李娜', '我')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 8000 + 400)).toBe(true)
    expect(chunks[0]).toMatch(/^我: 我问第/)
    expect(chunks.join('\n')).toContain('李娜: 哈哈哈 第 0 件事这样啦~／绝了')
    expect(chunks.join('\n')).toContain('语音里说的')
    // long histories keep the tail AND a spread of older blocks, not just the last N
    const many = Array.from({ length: 40 }, (_, i) => `块 ${i}`)
    const picked = selectChunks(many, 10)
    expect(picked).toHaveLength(10)
    expect(picked.slice(-6)).toEqual(many.slice(-6))
    expect(picked[0]).toBe('块 0')
    expect(selectChunks(many.slice(0, 8), 10)).toEqual(many.slice(0, 8))
  })

  it('validates partials leniently, merges locally and caps sizes', () => {
    const p = partialSchema.parse(extractJson(PARTIAL('')))
    expect(p.sharedEvents).toEqual([{ when: '2024 夏', what: '去青岛' }, { what: '没时间的事件' }])
    const loose = partialSchema.parse({ tone: 'not an array', punctuation: 12, replyHabits: 'x', sharedEvents: 'y' })
    expect(loose.tone).toEqual([])
    expect(loose.punctuation).toBe('12')
    expect(loose.replyHabits).toEqual({})
    const merged = mergeLocally([partialSchema.parse(extractJson(PARTIAL(' 旧'))), partialSchema.parse(extractJson(PARTIAL(' 新')))])
    expect(merged.facts).toEqual(['在杭州做设计 新', '在杭州做设计 旧'])
    expect(merged.catchphrases).toEqual(['哈哈哈', '绝了'])
    const { card, deep } = toCardAndDeep({ ...merged, tone: Array.from({ length: 20 }, (_, i) => `t${i}`) })
    expect(card.tone).toHaveLength(6)
    expect(deep.sharedEvents[1]).toEqual({ what: '没时间的事件' })
  })

  it('re-applies corrections onto arrays, strings and records', () => {
    const { card, deep } = toCardAndDeep(partialSchema.parse(extractJson(PARTIAL(''))))
    const r = applyCorrections(card, deep, [
      { at: 1, field: 'card.catchphrases', from: '绝了', to: '离谱' },
      { at: 2, field: 'card.catchphrases', from: '', to: '好家伙' },
      { at: 3, field: 'card.addressing.other', from: '老张', to: '张哥' },
      { at: 4, field: 'card.replyHabits.被抱怨时', from: '', to: '先调侃再安慰' },
      { at: 5, field: 'deep.boundaries', from: '不聊前任', to: '' },
      { at: 6, field: 'nope.x', from: '', to: 'y' },
      { at: 7, field: 'card', from: '{}', to: JSON.stringify({ tone: ['冷淡'], punctuation: '句号党', bogus: 1, topics: 'not-array' }) },
      { at: 8, field: 'deep', from: '{}', to: 'not json' },
      { at: 9, field: 'samples', from: '[]', to: '[]' },
      { at: 10, field: 'feedback:itm_1', from: 'down', to: '太客气了' },
    ])
    expect(r.applied).toBe(6)
    expect(r.card.tone).toEqual(['冷淡'])
    expect(r.card.punctuation).toBe('句号党')
    expect(r.card.topics).toEqual(['吃饭'])
    expect((r.card as unknown as Record<string, unknown>).bogus).toBeUndefined()
    expect(r.card.catchphrases).toEqual(['哈哈哈', '离谱', '好家伙'])
    expect(r.card.addressing.other).toBe('张哥')
    expect(r.card.replyHabits).toEqual({ 被问事情时: '先哈哈哈再答', 被抱怨时: '先调侃再安慰' })
    expect(r.deep.boundaries).toEqual([])
    expect(card.catchphrases).toEqual(['哈哈哈', '绝了']) // input untouched
  })
})

describe('createCloneBuilder', () => {
  it('builds a profile end-to-end with progress, samples and persisted status', async () => {
    const { relationships, model, builder, statuses } = setup(chat(400))
    await builder.start(CONTACT)
    const last = statuses[statuses.length - 1]
    expect(last).toEqual({ state: 'ready', version: 1, sampleCount: 40, builtAt: expect.any(Number) })
    const steps = statuses.filter((s) => s.state === 'building').map((s) => (s.state === 'building' ? s.progress.step : ''))
    expect(steps[0]).toBe('读取聊天记录')
    expect(steps.some((s) => s.startsWith('提炼说话风格'))).toBe(true)
    expect(steps).toContain('合并画像')
    expect(steps).toContain('生成样本对话与检索语料')
    expect(steps).toContain('写入本地画像 · 不上传')
    expect(steps.some((s) => s.includes('段语音已转写'))).toBe(true)
    const building = statuses.filter((s) => s.state === 'building')
    expect(building.every((s) => s.state === 'building' && s.progress.done <= s.progress.total)).toBe(true)
    const profile = await relationships.get(CONTACT)
    expect(profile?.displayName).toBe('娜娜')
    expect(profile?.role).toBe('contact')
    expect(profile?.card.catchphrases).toEqual(['哈哈哈', '绝了'])
    expect(profile?.card.tone).toContain('爱开玩笑 合并')
    expect(profile?.deep.sharedEvents[0]).toEqual({ when: '2024 夏', what: '去青岛' })
    expect(profile?.samples).toHaveLength(40)
    expect(await relationships.status(CONTACT)).toMatchObject({ state: 'ready', version: 1 })
    // chunk calls (≥2) + one merge call, at most 3 concurrent
    const chunkCalls = model.calls.filter((c) => c.system.includes('人物侧写师'))
    expect(chunkCalls.length).toBeGreaterThanOrEqual(2)
    expect(model.calls.filter((c) => c.system.includes('合并成一份'))).toHaveLength(1)
    expect(chunkCalls[0]?.system).toContain('「我」和「娜娜」')
    expect(builder.status(CONTACT)).toBeUndefined()
  })

  it('fails with too_few_messages below 300 unless forced; keeps corrections on re-clone', async () => {
    const { relationships, builder, statuses, selections } = setup(chat(120))
    await builder.start(CONTACT)
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'failed', kind: 'too_few_messages' })
    expect(await relationships.status(CONTACT)).toMatchObject({ state: 'failed', kind: 'too_few_messages' })
    await builder.start(CONTACT, { force: true })
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'ready', version: 1 })
    await relationships.appendCorrection(CONTACT, { at: 1, field: 'card.catchphrases', from: '绝了', to: '离谱' })
    const v1 = await relationships.get(CONTACT)
    if (!v1) throw new Error('profile missing')
    await relationships.upsert({ ...v1, samples: [...v1.samples, { prompt: '', reply: '用户手改的回复', at: 5, corrected: true }] })
    await builder.start(CONTACT, { force: true, model: { providerId: 'p', modelId: 'm' } })
    const v2 = await relationships.get(CONTACT)
    expect(v2?.version).toBe(2)
    expect(v2?.card.catchphrases).toEqual(['哈哈哈', '离谱'])
    expect(v2?.corrections).toHaveLength(1)
    expect(v2?.samples.filter((x) => x.corrected)).toEqual([{ prompt: '', reply: '用户手改的回复', at: 5, corrected: true }])
    // the unforced run fails on message count before a model is resolved
    expect(selections).toEqual([undefined, { providerId: 'p', modelId: 'm' }])
    await builder.start(CONTACT, { force: true, keepCorrections: false })
    const v3 = await relationships.get(CONTACT)
    expect(v3?.version).toBe(3)
    expect(v3?.card.catchphrases).toEqual(['哈哈哈', '绝了'])
    expect(v3?.corrections).toEqual([])
  })

  it('reports model failures and unparseable output as kind model', async () => {
    const bad = setup(chat(320), () => '这不是 JSON')
    await bad.builder.start(CONTACT)
    expect(bad.statuses[bad.statuses.length - 1]).toMatchObject({ state: 'failed', kind: 'model' })
    const noModel = setup(chat(320))
    const builder = createCloneBuilder({ substrate: noModel.substrate, relationships: noModel.relationships, model: async () => Promise.reject(new Error('无 Key')) })
    const seen: CloneStatus[] = []
    builder.onStatus((e) => seen.push(e.status))
    await builder.start(CONTACT)
    expect(seen[seen.length - 1]).toMatchObject({ state: 'failed', kind: 'model', error: expect.stringContaining('无 Key') })
  })

  it('cancel() aborts the build and restores the previous state; concurrent start is refused', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => (release = r))
    const { relationships, builder, statuses } = setup(chat(400), async (system) => {
      if (system.includes('人物侧写师')) {
        await gate
        return PARTIAL('')
      }
      return PARTIAL('')
    })
    const run = builder.start(CONTACT)
    await new Promise((r) => setTimeout(r, 20))
    await expect(builder.start(CONTACT)).rejects.toThrow(/正在克隆中/)
    expect(builder.status(CONTACT)?.state).toBe('building')
    builder.cancel(CONTACT)
    release?.()
    await run
    expect(statuses[statuses.length - 1]).toEqual({ state: 'none', messageCount: 0 })
    expect(await relationships.get(CONTACT)).toBeUndefined()
    expect(await relationships.status(CONTACT)).toEqual({ state: 'none', messageCount: 0 })
  })

  it('supports role self (profiles my side of the chat)', async () => {
    const { relationships, builder, model } = setup(chat(320))
    await builder.start(CONTACT, { role: 'self', displayName: '李娜' })
    const p = await relationships.get(CONTACT)
    expect(p?.role).toBe('self')
    expect(p?.displayName).toBe('我（对 李娜）')
    expect(model.calls[0]?.system).toContain('用户本人')
    // pairs are her → me, so sample replies come from my side
    expect(p?.samples.every((s) => s.reply.startsWith('我问第'))).toBe(true)
  })
})
