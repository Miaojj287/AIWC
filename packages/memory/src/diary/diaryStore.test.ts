import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiaryEntry } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { createDiaryStore, parseDiaryFile, renderDiaryFile, splitCues } from './diaryStore'

const tmp = () => mkdtempSync(join(tmpdir(), 'aiwc-diary-'))

const entry: DiaryEntry = {
  date: '2026-09-05',
  markdown: '## 今天\n忙了一天。\n\n## 人\n和李娜聊了青岛。\n\n## 待办\n- 周一评审\n\n## 一句话\n累但值得。',
  cues: ['李娜', '青岛', '周一评审 2026-09-08'],
  sources: { sessions: ['wxid_a', 'group@chatroom'], messageCount: 88, agentTurns: 2 },
  generatedAt: 1757100000000,
}

describe('diary file format', () => {
  it('renders frontmatter + trailing cue section and parses it back', () => {
    const raw = renderDiaryFile(entry)
    expect(raw.startsWith('---\ngeneratedAt: 1757100000000\ndegraded: false\n')).toBe(true)
    expect(raw.trimEnd().endsWith('## 记忆线索\n- 李娜\n- 青岛\n- 周一评审 2026-09-08')).toBe(true)
    expect(parseDiaryFile('2026-09-05', raw)).toEqual(entry)
  })

  it('strips a cue section the caller left in the markdown and marks degraded', () => {
    const raw = renderDiaryFile({ ...entry, degraded: true, cues: [], markdown: entry.markdown + '\n\n## 记忆线索\n* 内联线索\n1. 第二条' })
    const parsed = parseDiaryFile('2026-09-05', raw)
    expect(parsed.degraded).toBe(true)
    expect(parsed.cues).toEqual(['内联线索', '第二条'])
    expect(parsed.markdown).toBe(entry.markdown)
    expect(splitCues('无线索')).toEqual({ body: '无线索', cues: [] })
  })
})

describe('createDiaryStore', () => {
  it('put/get/list', async () => {
    const dir = tmp()
    const store = createDiaryStore({ dir })
    await store.put(entry)
    await store.put({ ...entry, date: '2026-09-04', degraded: true, generatedAt: 1 })
    expect(await store.get('2026-09-05')).toEqual(entry)
    expect(await store.get('2026-13-40')).toBeUndefined()
    expect(await store.get('2026-09-01')).toBeUndefined()
    expect(await store.list()).toEqual([
      { date: '2026-09-05', generatedAt: 1757100000000 },
      { date: '2026-09-04', generatedAt: 1, degraded: true },
    ])
    expect(readFileSync(join(dir, '2026-09-05.md'), 'utf8')).toContain('sessions:\n    - wxid_a')
    await expect(store.put({ ...entry, date: 'bad' })).rejects.toThrow(/YYYY-MM-DD/)
  })
})
