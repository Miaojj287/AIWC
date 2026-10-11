import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HistoryItem } from '@aiwc/protocol'
import { MEMORY_PROPOSALS_MAX, newItemId, newStepId, newTurnId } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../store/memoryStore'
import { createScriptedModel } from '../testing/fakes'
import { extractMemoryProposals, looksSensitive, renderReviewTranscript } from './extract'
import { createMemoryProposalStore } from './proposalStore'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aiwc-${p}-`))

const user = (text: string): HistoryItem => ({
  type: 'user_message',
  id: newItemId(),
  turnId: newTurnId(),
  createdAt: 1,
  content: [{ type: 'text', text }],
  mentions: [],
})
const agent = (text: string): HistoryItem => ({
  type: 'assistant_message',
  id: newItemId(),
  turnId: newTurnId(),
  stepId: newStepId(),
  createdAt: 2,
  text,
})

describe('memory store entry cap (设置 › 记忆 › 记忆条数上限)', () => {
  it('refuses adds past maxEntries without evicting, and follows a changed cap at once', async () => {
    let cap = 2
    const store = createMemoryStore({ dir: tmp('cap'), maxEntries: () => cap })
    expect(await store.addEntry('MEMORY', '一')).toEqual({ ok: true })
    expect(await store.addEntry('MEMORY', '二')).toEqual({ ok: true })
    expect(await store.addEntry('MEMORY', '三')).toEqual({ ok: false, reason: 'over_count' })
    expect((await store.entries('MEMORY')).map((e) => e.text)).toEqual(['一', '二'])
    // A different file has its own count; the user's own editor write is never capped.
    expect(await store.addEntry('USER', '甲')).toEqual({ ok: true })
    await store.write('MEMORY', '一\n§\n二\n§\n三\n§\n四')
    expect(await store.entries('MEMORY')).toHaveLength(4)
    cap = 10
    expect(await store.addEntry('MEMORY', '五')).toEqual({ ok: true })
  })
})

describe('createMemoryProposalStore', () => {
  it('adds, dedups, persists, notifies and removes proposals', async () => {
    const dir = tmp('prop')
    let clock = 100
    const store = createMemoryProposalStore({ dir, now: () => clock })
    const seen: number[] = []
    store.subscribe((items, added) => seen.push(items.length * 10 + added.length))
    const a = await store.add({ file: 'USER', text: ' 用户喜欢喝美式 ', origin: 'extraction', threadId: 'thr_x' })
    clock = 200
    const b = await store.add({ file: 'MEMORY', text: '每周五开周会', origin: 'agent' })
    expect(a.ok && a.proposal.text).toBe('用户喜欢喝美式')
    expect(await store.add({ file: 'MEMORY', text: '用户喜欢喝美式。', origin: 'agent' })).toEqual({
      ok: false,
      reason: 'duplicate',
    })
    expect(store.list().map((p) => p.text)).toEqual(['每周五开周会', '用户喜欢喝美式'])
    // Reopening reads the same list back.
    expect(createMemoryProposalStore({ dir }).list()).toHaveLength(2)
    expect(await store.remove([b.ok ? b.proposal.id : ''])).toBe(1)
    expect(store.list()).toHaveLength(1)
    expect(seen).toEqual([11, 21, 10])
  })

  it(`refuses new proposals once ${MEMORY_PROPOSALS_MAX} are pending`, async () => {
    const store = createMemoryProposalStore({ dir: tmp('full') })
    for (let i = 0; i < MEMORY_PROPOSALS_MAX; i++)
      expect((await store.add({ file: 'MEMORY', text: `事实 ${i}`, origin: 'extraction' })).ok).toBe(true)
    expect(await store.add({ file: 'MEMORY', text: '再一条', origin: 'extraction' })).toEqual({
      ok: false,
      reason: 'full',
    })
  })

  it('reads a corrupt file as empty and skips invalid items', () => {
    const dir = tmp('corrupt')
    const notes: string[] = []
    writeFileSync(
      join(dir, 'proposals.json'),
      JSON.stringify({
        items: [{ id: 'bad' }, { id: 'mp_abcdefgh', file: 'USER', text: 'ok', origin: 'agent', createdAt: 1 }],
      }),
    )
    const store = createMemoryProposalStore({ dir, onCorrupt: (d) => notes.push(d) })
    expect(store.list().map((p) => p.id)).toEqual(['mp_abcdefgh'])
    expect(notes).toHaveLength(1)
  })

  it('accept writes through the memory store (budget, cap and drift apply) and keeps the proposal on refusal', async () => {
    const dir = tmp('accept')
    const memory = createMemoryStore({ dir, limits: { USER: 30 }, maxEntries: () => 1 })
    const proposals = createMemoryProposalStore({ dir })
    const first = await proposals.add({ file: 'USER', text: '用户叫阿明', origin: 'extraction' })
    const second = await proposals.add({ file: 'USER', text: '用户住在杭州', origin: 'extraction' })
    if (!first.ok || !second.ok) throw new Error('setup')

    expect(await proposals.accept(memory, { id: first.proposal.id })).toEqual({ ok: true })
    expect((await memory.entries('USER')).map((e) => [e.text, e.source])).toEqual([['用户叫阿明', 'user']])
    // The cap holds: refused, nothing written, the proposal stays for later.
    expect(await proposals.accept(memory, { id: second.proposal.id })).toEqual({ ok: false, reason: 'over_count' })
    expect(proposals.list()).toHaveLength(1)
    // Edited text into the other file is written instead.
    expect(await proposals.accept(memory, { id: second.proposal.id, file: 'MEMORY', text: '住在杭州' })).toEqual({
      ok: true,
    })
    expect(proposals.list()).toEqual([])
    expect(await proposals.accept(memory, { id: second.proposal.id })).toEqual({ ok: false, reason: 'not_found' })

    // A file edited outside the app into a shape a rewrite cannot keep: refused as blocked.
    const p3 = await proposals.add({ file: 'MEMORY', text: '新事实', origin: 'agent' })
    if (!p3.ok) throw new Error('setup')
    writeFileSync(memory.pathFor('MEMORY'), 'free form text that is not tool shaped '.repeat(200))
    expect(await proposals.accept(memory, { id: p3.proposal.id })).toEqual({ ok: false, reason: 'blocked' })
  })

  it('keeps per-thread extraction watermarks across reopen', async () => {
    const dir = tmp('wm')
    const store = createMemoryProposalStore({ dir })
    expect(store.extractedCount('thr_a')).toBe(0)
    await store.markExtracted('thr_a', 3)
    expect(createMemoryProposalStore({ dir }).extractedCount('thr_a')).toBe(3)
    expect(JSON.parse(readFileSync(join(dir, 'proposals.json'), 'utf8')).items).toEqual([])
  })
})

describe('idle-conversation extraction', () => {
  it('renders only what follows the watermark, owner lines first-class', () => {
    const items = [user('我叫阿明'), agent('好的阿明'), user('以后回答都简短一点'), agent('明白')]
    const all = renderReviewTranscript(items, 0)
    expect(all.transcript).toBe('我: 我叫阿明\nAgent: 好的阿明\n我: 以后回答都简短一点\nAgent: 明白')
    expect(all.userMessages).toBe(2)
    const rest = renderReviewTranscript(items, 1)
    expect(rest.transcript).toBe('我: 以后回答都简短一点\nAgent: 明白')
    expect(rest.newUserMessages).toBe(1)
    expect(renderReviewTranscript(items, 2).newUserMessages).toBe(0)
  })

  it('keeps new, non-sensitive points and drops existing ones', async () => {
    const model = createScriptedModel(() =>
      JSON.stringify({
        items: [
          { file: 'USER', text: '用户希望回答简短' },
          { file: 'USER', text: '用户叫阿明' },
          { file: 'MEMORY', text: '用户的 API key 是 sk-abcdefghijklmnopqrstu' },
          { file: 'SOUL', text: '用户每周五开周会' },
        ],
      }),
    )
    const found = await extractMemoryProposals(model, { transcript: '我: …', existing: ['用户叫阿明'] })
    expect(found).toEqual([
      { file: 'USER', text: '用户希望回答简短' },
      { file: 'MEMORY', text: '用户每周五开周会' },
    ])
    expect(model.calls[0]?.user).toContain('- 用户叫阿明')
    expect(model.calls[0]?.user).toContain('<conversation>')
  })

  it('makes no call for an empty transcript, and surfaces model failures', async () => {
    const model = createScriptedModel(() => {
      throw new Error('boom')
    })
    expect(await extractMemoryProposals(model, { transcript: '  ', existing: [] })).toEqual([])
    expect(model.calls).toHaveLength(0)
    await expect(extractMemoryProposals(model, { transcript: '我: x', existing: [] })).rejects.toThrow()
  })

  it('flags secrets and long numbers as sensitive', () => {
    expect(looksSensitive('密码是 123456')).toBe(true)
    expect(looksSensitive('卡号 6222020200112233445')).toBe(true)
    expect(looksSensitive('用户喜欢猫')).toBe(false)
  })
})
