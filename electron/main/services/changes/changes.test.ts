import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallId, MemoryFile, ThreadId, TurnId } from '@aiwc/protocol'
import { createMemoryStore } from '@aiwc/memory'
import { createChangeJournal, type ChangeJournal } from './journal'
import { createChangeRecorder } from './recorder'
import { createCaptureCache } from './workspaceCapture'

const thread = 'thr_1' as ThreadId
const turn = 'trn_1' as TurnId
let root: string
let workspace: string
let skills: string
let trashed: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-changes-'))
  workspace = join(root, 'workspace')
  skills = join(root, 'skills')
  mkdirSync(workspace)
  mkdirSync(skills)
  trashed = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup() {
  const memory = createMemoryStore({ dir: join(root, 'memory') })
  const trash = async (path: string) => {
    trashed.push(path)
    rmSync(path, { recursive: true, force: true })
  }
  const journal: ChangeJournal = createChangeJournal({
    dir: join(root, 'changes'),
    undo: { roots: { workspace, skills: () => skills }, trash, memory, refreshSkills: async () => {} },
  })
  const onRecorded = vi.fn()
  const hook = createChangeRecorder({
    journal,
    workspaceDir: workspace,
    skillsDir: () => skills,
    cache: createCaptureCache(),
    memoryEntries: (file: MemoryFile) => memory.entries(file),
    chatName: async (id) => (id === 'wxid_a' ? 'Alice' : undefined),
    onRecorded,
  })
  let n = 0
  const call = async (toolName: string, input: unknown, run: () => void | Promise<void>, isError = false) => {
    const callId = `cal_${++n}` as CallId
    await hook.run('PreToolUse', { threadId: thread, turnId: turn, callId, toolName, input })
    await run()
    await hook.run('PostToolUse', { threadId: thread, turnId: turn, callId, toolName, input, isError })
  }
  return { journal, memory, call, onRecorded }
}

describe('change journal', () => {
  it('records the files a shell command created, changed and deleted, and undoes each', async () => {
    writeFileSync(join(workspace, 'keep.md'), 'v1')
    writeFileSync(join(workspace, 'old.txt'), 'bye')
    const { journal, call, onRecorded } = setup()
    await call('shell', { command: 'x' }, () => {
      writeFileSync(join(workspace, 'keep.md'), 'v2')
      writeFileSync(join(workspace, 'new.csv'), 'a,b')
      rmSync(join(workspace, 'old.txt'))
    })
    const listed = journal.list(thread)
    expect(listed.map((c) => [c.target, c.action])).toEqual([
      ['keep.md', 'modified'],
      ['new.csv', 'created'],
      ['old.txt', 'deleted'],
    ])
    expect(onRecorded).toHaveBeenCalledWith(thread, turn)
    for (const change of listed) expect(await journal.undo(change.id)).toEqual({ ok: true })
    expect(readFileSync(join(workspace, 'keep.md'), 'utf8')).toBe('v1')
    expect(readFileSync(join(workspace, 'old.txt'), 'utf8')).toBe('bye')
    // A created file goes to the trash (recoverable), never a hard delete.
    expect(trashed).toEqual([join(workspace, 'new.csv')])
    expect(await journal.undo(listed[0]?.id ?? '')).toEqual({ ok: false, reason: 'already_undone' })
  })

  it('refuses to undo over later edits, and records nothing for failed or read-only calls', async () => {
    writeFileSync(join(workspace, 'doc.md'), 'agent-before')
    const { journal, call } = setup()
    await call('shell', {}, () => writeFileSync(join(workspace, 'doc.md'), 'agent-after'))
    writeFileSync(join(workspace, 'doc.md'), 'user edited since')
    const [change] = journal.list(thread)
    expect(await journal.undo(change?.id ?? '')).toEqual({ ok: false, reason: 'conflict' })
    expect(readFileSync(join(workspace, 'doc.md'), 'utf8')).toBe('user edited since')

    await call('shell', {}, () => writeFileSync(join(workspace, 'x.md'), 'x'), true)
    await call('shell', {}, () => {})
    expect(journal.list(thread)).toHaveLength(1)
  })

  it('records memory adds and removals with their thread, and undoes them precisely', async () => {
    const { journal, memory, call } = setup()
    await call('remember', { file: 'MEMORY', text: '周五交周报' }, async () => {
      await memory.addEntry('MEMORY', '周五交周报', { source: 'agent', threadId: thread })
    })
    await memory.addEntry('MEMORY', '用户自己加的')
    const [added] = journal.list(thread)
    expect(added).toMatchObject({ kind: 'memory', action: 'added', target: 'MEMORY', excerpt: '周五交周报' })
    expect(await journal.undo(added?.id ?? '')).toEqual({ ok: true })
    expect((await memory.entries('MEMORY')).map((e) => e.text)).toEqual(['用户自己加的'])

    await call('forget', { file: 'MEMORY', index: 0, text: '用户自己加的' }, async () => {
      await memory.removeEntry('MEMORY', 0, '用户自己加的')
    })
    const removed = journal.list(thread).find((c) => c.action === 'removed')
    expect(await journal.undo(removed?.id ?? '')).toEqual({ ok: true })
    const [restored] = await memory.entries('MEMORY')
    expect(restored).toMatchObject({ text: '用户自己加的', threadId: thread })
  })

  it('skips a remember that was only proposed (nothing written)', async () => {
    const { journal, call } = setup()
    await call('remember', { file: 'USER', text: '待确认' }, () => {})
    expect(journal.list(thread)).toEqual([])
  })

  it('records skills (undo of a created one trashes its folder) and lists sends as not undoable', async () => {
    const { journal, call } = setup()
    await call('skill_manage', { action: 'create', name: 'weekly' }, () => {
      mkdirSync(join(skills, 'weekly'))
      writeFileSync(join(skills, 'weekly', 'SKILL.md'), '---\nname: weekly\n---')
    })
    await call('send_message', { to: 'wxid_a', text: '晚上见' }, () => {})
    const [skill, sent] = journal.list(thread)
    expect(skill).toMatchObject({ kind: 'skill', action: 'created', target: 'weekly', undoable: true })
    expect(sent).toMatchObject({ kind: 'message', action: 'sent', target: 'Alice', excerpt: '晚上见', undoable: false })
    expect(await journal.undo(sent?.id ?? '')).toEqual({ ok: false, reason: 'not_undoable' })
    expect(await journal.undo(skill?.id ?? '')).toEqual({ ok: true })
    expect(existsSync(join(skills, 'weekly'))).toBe(false)
  })

  it('survives a restart and never lets a tampered path escape its root', async () => {
    writeFileSync(join(workspace, 'a.md'), '1')
    const first = setup()
    await first.call('shell', {}, () => writeFileSync(join(workspace, 'a.md'), '2'))
    const again = setup()
    const [change] = again.journal.list(thread)
    expect(change).toMatchObject({ target: 'a.md', action: 'modified' })

    const file = join(root, 'changes', 'journal.jsonl')
    writeFileSync(file, readFileSync(file, 'utf8').replace('"path":"a.md"', '"path":"../../etc/passwd"'))
    const tampered = setup()
    expect(await tampered.journal.undo(change?.id ?? '')).toEqual({ ok: false, reason: 'failed' })
  })
})
