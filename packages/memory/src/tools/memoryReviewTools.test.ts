import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnyToolDefinition, ToolContext } from '@aiwc/protocol'
import { asCallId, asThreadId, asTurnId, newStepId } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { createMemoryProposalStore } from '../review/proposalStore'
import { createMemoryStore } from '../store/memoryStore'
import { memoryTools } from './memoryTools'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aiwc-${p}-`))

function ctxFor<S extends Record<string, unknown>>(services: S): ToolContext<S> {
  return {
    threadId: asThreadId('thr_review'),
    turnId: asTurnId('trn_t'),
    stepId: newStepId(),
    callId: asCallId('cal_t'),
    channel: 'desktop',
    profile: 'desktop-chat',
    signal: new AbortController().signal,
    services,
    progress: () => {},
    depth: 0,
  }
}

const remember = (tools: AnyToolDefinition[]) => {
  const t = tools.find((x) => x.name === 'remember')
  if (!t) throw new Error('remember')
  return t
}

describe('remember under 设置 › 记忆 policy', () => {
  it('写入前需要确认 on: files a proposal instead of writing, classified as a read (no second approval)', async () => {
    const dir = tmp('hold')
    const memory = createMemoryStore({ dir })
    const proposals = createMemoryProposalStore({ dir })
    let confirm = true
    const tool = remember(
      memoryTools({ review: { confirmBeforeWrite: () => confirm, propose: (input) => proposals.add(input) } }),
    )
    expect(tool.classify?.({ file: 'USER', text: 'x' })).toEqual({ risk: 'read' })
    const r = await tool.execute({ file: 'USER', text: '用户喜欢猫' }, ctxFor({ memory }))
    expect(r.isError).toBeUndefined()
    expect(await memory.entries('USER')).toEqual([])
    expect(proposals.list().map((p) => [p.text, p.origin, p.threadId])).toEqual([['用户喜欢猫', 'agent', 'thr_review']])
    // The same text again is not queued twice.
    await tool.execute({ file: 'USER', text: '用户喜欢猫' }, ctxFor({ memory }))
    expect(proposals.list()).toHaveLength(1)

    confirm = false
    expect(tool.classify?.({ file: 'USER', text: 'x' })).toEqual({ risk: 'write' })
    await tool.execute({ file: 'USER', text: '用户喜欢狗' }, ctxFor({ memory }))
    expect((await memory.entries('USER')).map((e) => e.text)).toEqual(['用户喜欢狗'])
  })

  it('reports the entry cap as a failure the model can act on', async () => {
    const memory = createMemoryStore({ dir: tmp('cap'), maxEntries: () => 1 })
    const tool = remember(memoryTools())
    await tool.execute({ file: 'MEMORY', text: '第一条' }, ctxFor({ memory }))
    const r = await tool.execute({ file: 'MEMORY', text: '第二条' }, ctxFor({ memory }))
    expect(r.isError).toBe(true)
    expect(String(r.content)).toContain('forget')
    expect(await memory.entries('MEMORY')).toHaveLength(1)
  })
})
