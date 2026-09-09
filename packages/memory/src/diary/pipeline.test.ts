import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WxMessage } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../store/memoryStore'
import { createFakeSubstrate, createScriptedModel, fakeMessage, fakeSession } from '../testing/fakes'
import { createDiaryStore } from './diaryStore'
import { createDiaryPipeline } from './pipeline'
import { parseSynthesis } from './prompts'
import { diaryWindow, messageText, sampleEvenly, targetDateFor } from './select'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aiwc-${p}-`))
const DATE = '2026-09-05'
const HOUR = 2
const W = diaryWindow(DATE, HOUR)

function buildData() {
  const sessions = [
    fakeSession({ id: 'wxid_lina', title: '李娜', lastMessageAt: W.start + 3_600_000 * 5 }),
    fakeSession({ id: 'g1@chatroom', title: '产品市场群', kind: 'group', lastMessageAt: W.start + 3_600_000 * 8 }),
    fakeSession({ id: 'wxid_old', title: '很久没聊', lastMessageAt: W.start - 86_400_000 * 3 }),
    fakeSession({ id: 'gh_news', title: '某公众号', kind: 'official', lastMessageAt: W.start + 1000 }),
    fakeSession({ id: 'wxid_quiet', title: '安静', lastMessageAt: W.start + 1000 }),
  ]
  const messages: WxMessage[] = []
  let seq = 1
  for (let i = 0; i < 12; i++) {
    messages.push(
      fakeMessage({ sessionId: 'wxid_lina', seq: seq++, createdAt: W.start + 3_600_000 * 4 + i * 60_000, isSelf: i % 2 === 0, text: i % 2 === 0 ? `我说第 ${i} 句` : `李娜回第 ${i} 句，周一评审记得来` }),
    )
  }
  for (let i = 0; i < 60; i++) {
    messages.push(
      fakeMessage({ sessionId: 'g1@chatroom', seq: seq++, createdAt: W.start + 3_600_000 * 7 + i * 30_000, senderId: `u${i % 4}`, senderName: `群友${i % 4}`, text: `讨论第 ${i} 条，${'很长的内容'.repeat(60)}` }),
    )
  }
  messages.push(fakeMessage({ sessionId: 'g1@chatroom', seq: seq++, createdAt: W.start + 3_600_000 * 7, kind: 'voice', media: { kind: 'voice', transcript: '这是语音转写' } }))
  messages.push(fakeMessage({ sessionId: 'g1@chatroom', seq: seq++, createdAt: W.start + 3_600_000 * 7, kind: 'system', text: '某人加入群聊' }))
  // outside the window → must be ignored
  messages.push(fakeMessage({ sessionId: 'wxid_quiet', seq: seq++, createdAt: W.end + 1000, text: '窗口外' }))
  messages.push(fakeMessage({ sessionId: 'wxid_old', seq: seq++, createdAt: W.start - 1000, text: '窗口前' }))
  return { sessions, messages }
}

const GOOD_DIARY = `## 今天
${'今天和李娜聊了周一的评审，产品市场群里吵吵闹闹讨论了一整天。'.repeat(4)}

## 人
李娜还是那样，提醒我别忘了评审。

## 待办
- 周一评审

## 一句话
忙，但心里踏实。

## 记忆线索
- 李娜
- 周一评审 2026-09-08
- 产品市场群 讨论

## 稳定事实
- 李娜负责周一评审的组织
- 这条不确定所以不该有太多
- 第三条事实
- 第四条应被截掉`

describe('diary window & helpers', () => {
  it('computes [date-1 @ hour, date @ hour) and the target date for now', () => {
    expect(W.end - W.start).toBe(86_400_000)
    expect(new Date(W.end).getHours()).toBe(HOUR)
    expect(new Date(W.end).getDate()).toBe(5)
    const at = (h: number) => new Date(`${DATE}T${String(h).padStart(2, '0')}:30:00`).getTime()
    expect(targetDateFor(at(1), HOUR)).toBe('2026-09-04')
    expect(targetDateFor(at(2), HOUR)).toBe(DATE)
    expect(targetDateFor(at(23), HOUR)).toBe(DATE)
  })
  it('samples evenly and renders message kinds', () => {
    expect(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10])
    expect(sampleEvenly([1, 2], 5)).toEqual([1, 2])
    expect(messageText(fakeMessage({ sessionId: 'a', seq: 1, createdAt: 0, kind: 'voice' }))).toBe('[语音]')
    expect(messageText(fakeMessage({ sessionId: 'a', seq: 1, createdAt: 0, kind: 'system', text: 'x' }))).toBe('')
    expect(messageText(fakeMessage({ sessionId: 'a', seq: 1, createdAt: 0, kind: 'file', media: { kind: 'file', fileName: 'a.pdf' } }))).toBe('[文件 a.pdf]')
  })
  it('parses synthesis output into body / cues / facts', () => {
    const p = parseSynthesis('```markdown\n' + GOOD_DIARY + '\n```')
    expect(p.body.startsWith('## 今天')).toBe(true)
    expect(p.body).not.toContain('记忆线索')
    expect(p.cues).toEqual(['李娜', '周一评审 2026-09-08', '产品市场群 讨论'])
    expect(p.facts).toHaveLength(3)
    expect(() => parseSynthesis('太短')).toThrow()
  })
})

describe('createDiaryPipeline', () => {
  const setup = (handler: (system: string, user: string) => string, opts: { rollout?: boolean; noModel?: boolean } = {}) => {
    const substrate = createFakeSubstrate(buildData())
    const memory = createMemoryStore({ dir: tmp('mem') })
    const diaries = createDiaryStore({ dir: tmp('diary') })
    const model = createScriptedModel(handler)
    const pipeline = createDiaryPipeline({
      substrate,
      memory,
      diaries,
      model: opts.noModel ? async () => Promise.reject(new Error('未配置模型')) : async () => model,
      schedule: () => ({ enabled: true, hour: HOUR, customPrompt: '多写点心情' }),
      now: () => W.end + 60_000,
      ...(opts.rollout
        ? {
            rolloutSearch: async (q: string) => [
              { threadId: 't1', itemId: `i-${q}`, snippet: `和助手聊了 ${q} 的周报`, ts: W.start + 1000 },
              { threadId: 't1', itemId: `out-${q}`, snippet: '窗口外', ts: W.end + 1 },
            ],
          }
        : {}),
    })
    return { substrate, memory, diaries, model, pipeline }
  }

  it('produces a synthesised entry, respects bounds and feeds stable facts into MEMORY', async () => {
    const { substrate, memory, diaries, model, pipeline } = setup((system, user) => {
      if (system.includes('私人日记助手')) return `${user.slice(1, user.indexOf('】'))}：聊了些事，情绪平稳。`
      return GOOD_DIARY
    }, { rollout: true })
    const steps: string[] = []
    const entry = await pipeline.run(DATE, { onProgress: (s) => steps.push(s) })
    expect(entry.degraded).toBeUndefined()
    expect(entry.markdown).toContain('## 一句话')
    expect(entry.markdown).not.toContain('稳定事实')
    expect(entry.cues).toEqual(['李娜', '周一评审 2026-09-08', '产品市场群 讨论'])
    expect(entry.sources.sessions).toEqual(['g1@chatroom', 'wxid_lina']) // ranked by message count
    expect(entry.sources.messageCount).toBe(61 + 12)
    expect(entry.sources.agentTurns).toBe(2)
    expect([...new Set(steps)]).toEqual(['选材', '按会话小结', '综合', '写入', '完成'])
    // one summary per session + one synthesis call
    expect(model.calls).toHaveLength(3)
    const groupCall = model.calls.find((c) => c.user.startsWith('【产品市场群】'))
    expect(groupCall).toBeDefined()
    const lines = (groupCall?.user ?? '').split('\n').slice(1)
    expect(lines.length).toBeLessThanOrEqual(40)
    expect(lines.every((l) => l.length <= 200 + 40)).toBe(true)
    expect(groupCall?.user).toContain('[语音] 这是语音转写')
    expect(groupCall?.user).not.toContain('加入群聊')
    const synth = model.calls[2]
    expect(synth?.system).toContain('多写点心情')
    expect(synth?.user).toContain('【与 AI 助手的对话摘要】')
    expect(synth?.user).not.toContain('窗口外')
    // never probed sessions outside the window / official accounts
    expect(substrate.calls.filter((c) => c.startsWith('listMessages:'))).not.toContain('listMessages:wxid_old')
    expect(substrate.calls).not.toContain('listMessages:gh_news')
    // stored + memory
    expect((await diaries.get(DATE))?.cues).toEqual(entry.cues)
    const mem = await memory.entries('MEMORY')
    expect(mem.map((e) => e.text)).toEqual(['李娜负责周一评审的组织', '这条不确定所以不该有太多', '第三条事实'])
    expect(mem[0]?.source).toBe('diary')
    // second run without force returns the stored entry without calling the model again
    await pipeline.run(DATE)
    expect(model.calls).toHaveLength(3)
  })

  it('writes a degraded entry from per-session summaries when synthesis fails', async () => {
    const { model, pipeline } = setup((system) => {
      if (system.includes('私人日记助手')) return '会话小结。'
      throw new Error('boom')
    })
    const entry = await pipeline.run(DATE)
    expect(entry.degraded).toBe(true)
    expect(entry.markdown).toContain('降级版日记')
    expect(entry.markdown).toContain('### 产品市场群')
    expect(entry.markdown).toContain('会话小结。')
    expect(entry.cues).toEqual(['产品市场群', '李娜', '降级日记'])
    expect(model.calls).toHaveLength(3)
    // a degraded entry is retried on the next run even without force
    await pipeline.run(DATE)
    expect(model.calls).toHaveLength(6)
  })

  it('writes a degraded entry from raw excerpts when no model is configured', async () => {
    const { pipeline, memory } = setup(() => 'unused', { noModel: true })
    const entry = await pipeline.run(DATE)
    expect(entry.degraded).toBe(true)
    expect(entry.markdown).toContain('未配置模型')
    expect(entry.markdown).toContain('原始摘录')
    expect(entry.markdown).toContain('李娜回第')
    expect(await memory.entries('MEMORY')).toEqual([])
  })

  it('writes an empty-day entry without touching the model', async () => {
    const { model, pipeline } = setup(() => 'unused')
    const entry = await pipeline.run('2020-01-01')
    expect(entry.sources.messageCount).toBe(0)
    expect(entry.cues.length).toBeGreaterThanOrEqual(3)
    expect(model.calls).toHaveLength(0)
    await expect(pipeline.run('2020-1-1')).rejects.toThrow(/YYYY-MM-DD/)
  })

  it('schedules with croner and catches up on start', async () => {
    const { diaries, pipeline } = setup((system) => (system.includes('私人日记助手') ? '小结' : GOOD_DIARY))
    expect(pipeline.nextScheduledAt()).toBeUndefined()
    expect(pipeline.targetDateNow()).toBe(DATE)
    const produced = await pipeline.runCatchUp()
    expect(produced?.date).toBe(DATE)
    expect((await diaries.list()).map((d) => d.date)).toEqual([DATE])
    expect(await pipeline.runCatchUp()).toBeUndefined() // already up to date
    pipeline.start()
    const next = pipeline.nextScheduledAt()
    expect(next).toBeTypeOf('number')
    expect(new Date(next as number).getHours()).toBe(HOUR)
    pipeline.stop()
    expect(pipeline.nextScheduledAt()).toBeUndefined()
  })
})
