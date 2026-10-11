/**
 * Turns tool calls into change-journal entries, as a kernel hook: PreToolUse captures what a call may replace
 * (workspace bytes for `shell`, the SKILL.md for skill tools, whether a memory entry existed), PostToolUse compares
 * and records what really changed. Failed calls record nothing. Sends are listed (never undoable).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CallId, MemoryFile, ThreadId, TurnId } from '@aiwc/protocol'
import type { Hook, HookPayload } from '@aiwc/kernel'
import type { ChangeJournal, StoredChange } from './journal'
import { captureWorkspace, diffCaptures, sha256, type Capture, type CaptureCache } from './workspaceCapture'

/** Changes listed per call; a command that rewrote a whole tree gets its first ones (and the rest summed up). */
export const MAX_CHANGES_PER_CALL = 20
/** Characters of a memory entry / sent text kept as the row's excerpt. */
const EXCERPT_CHARS = 80
const SKILL_NAME_RE = /^[a-z0-9-]{2,40}$/
const SEND_TOOLS = new Set(['send_message', 'send_media', 'office_push_table'])
/** Memory files the Agent can write; the other two are user-only. */
const AGENT_MEMORY_FILES = new Set<MemoryFile>(['MEMORY', 'USER'])

type Pending =
  | { kind: 'shell'; before: Capture }
  | { kind: 'skill'; name: string; before: Buffer | undefined }
  | { kind: 'remember'; existed: boolean }

/**
 * A call that times out or is interrupted never reaches PostToolUse, so its capture would stay behind: keep only a
 * few recent ones (write tools are not parallel-safe, one at a time is the norm).
 */
const MAX_PENDING = 8

export interface ChangeRecorderDeps {
  journal: ChangeJournal
  workspaceDir: string
  skillsDir: () => string | undefined
  cache: CaptureCache
  memoryEntries: (file: MemoryFile) => Promise<Array<{ text: string }>>
  /** Display name for a chat id (the session title); falls back to the id. */
  chatName?: (chatId: string) => Promise<string | undefined>
  /** A thread's journal changed (the panel refreshes that thread's turn summaries). */
  onRecorded?: (threadId: ThreadId, turnId: TurnId) => void
  now?: () => number
}

const field = (input: unknown, key: string): unknown =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const excerpt = (text: string): string =>
  text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text.replace(/\s+/g, ' ')
const memoryFileOf = (input: unknown): MemoryFile | undefined => {
  const file = str(field(input, 'file'))
  return file && AGENT_MEMORY_FILES.has(file as MemoryFile) ? (file as MemoryFile) : undefined
}
const sameText = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

export function createChangeRecorder(deps: ChangeRecorderDeps): Hook {
  const now = deps.now ?? Date.now
  const pending = new Map<CallId, Pending>()
  const remember = (callId: CallId, entry: Pending): void => {
    pending.set(callId, entry)
    while (pending.size > MAX_PENDING) {
      const oldest = pending.keys().next().value
      if (oldest === undefined) break
      pending.delete(oldest)
    }
  }

  const skillFile = (name: string): string | undefined => {
    const dir = deps.skillsDir()
    return dir && SKILL_NAME_RE.test(name) ? join(dir, name, 'SKILL.md') : undefined
  }
  const readIfExists = (path: string | undefined): Buffer | undefined => {
    if (!path || !existsSync(path)) return undefined
    try {
      return readFileSync(path)
    } catch {
      return undefined
    }
  }

  async function before(p: HookPayload & { callId: CallId }): Promise<void> {
    switch (p.toolName) {
      case 'shell': {
        const capture = captureWorkspace(deps.workspaceDir, deps.cache)
        if (capture) remember(p.callId, { kind: 'shell', before: capture })
        return
      }
      case 'skill_manage':
      case 'skill_delete': {
        const name = str(field(p.input, 'name'))
        if (name) remember(p.callId, { kind: 'skill', name, before: readIfExists(skillFile(name)) })
        return
      }
      case 'remember': {
        const file = memoryFileOf(p.input)
        const text = str(field(p.input, 'text'))
        if (!file || !text) return
        const existed = (await deps.memoryEntries(file)).some((e) => sameText(e.text, text))
        remember(p.callId, { kind: 'remember', existed })
        return
      }
      default:
        return
    }
  }

  async function after(p: HookPayload & { callId: CallId; turnId: TurnId }): Promise<void> {
    const pre = pending.get(p.callId)
    pending.delete(p.callId)
    if (p.isError) return
    const base = { threadId: p.threadId, turnId: p.turnId, callId: p.callId, toolName: p.toolName ?? '', at: now() }
    const record = (change: Omit<StoredChange, 'id' | 'undoneAt' | keyof typeof base>, blob?: Buffer) =>
      deps.journal.record({ ...base, ...change }, blob)
    let recorded = 0

    if (pre?.kind === 'shell') {
      const after = captureWorkspace(deps.workspaceDir, deps.cache)
      if (!after) return
      for (const diff of diffCaptures(pre.before, after).slice(0, MAX_CHANGES_PER_CALL)) {
        const keptBefore = diff.before?.content
        const undoable = diff.action === 'created' || keptBefore !== undefined
        record(
          {
            kind: 'file',
            action: diff.action,
            target: diff.path,
            undoable,
            plan: { type: 'file', root: 'workspace', path: diff.path, afterHash: diff.after?.hash },
          },
          diff.action === 'created' ? undefined : keptBefore,
        )
        recorded++
      }
    } else if (pre?.kind === 'skill') {
      const current = readIfExists(skillFile(pre.name))
      if (!pre.before && !current) return
      if (pre.before && current && pre.before.equals(current)) return
      const action = !pre.before ? 'created' : current ? 'modified' : 'deleted'
      const afterHash = current ? sha256(current) : undefined
      record(
        {
          kind: 'skill',
          action,
          target: pre.name,
          undoable: true,
          plan:
            action === 'created'
              ? { type: 'file', root: 'skills', path: pre.name, dir: true, afterHash }
              : { type: 'file', root: 'skills', path: `${pre.name}/SKILL.md`, afterHash },
        },
        action === 'created' ? undefined : pre.before,
      )
      recorded++
    } else if (pre?.kind === 'remember') {
      const file = memoryFileOf(p.input)
      const text = str(field(p.input, 'text'))
      if (!file || !text || pre.existed) return
      // Held for review (设置 › 记忆 › 写入前需要确认) or refused: nothing was written.
      if (!(await deps.memoryEntries(file)).some((e) => sameText(e.text, text))) return
      record({
        kind: 'memory',
        action: 'added',
        target: file,
        excerpt: excerpt(text),
        undoable: true,
        plan: { type: 'memory-remove', file, text },
      })
      recorded++
    } else if (p.toolName === 'forget') {
      const file = memoryFileOf(p.input)
      const text = str(field(p.input, 'text'))
      if (!file || !text) return
      record({
        kind: 'memory',
        action: 'removed',
        target: file,
        excerpt: excerpt(text),
        undoable: true,
        plan: { type: 'memory-add', file, text, threadId: p.threadId },
      })
      recorded++
    } else if (p.toolName && SEND_TOOLS.has(p.toolName)) {
      const to = str(field(p.input, 'to'))
      const title = str(field(p.input, 'title'))
      const text = str(field(p.input, 'text')) ?? str(field(p.input, 'caption'))
      const target = title ?? (to ? ((await deps.chatName?.(to).catch(() => undefined)) ?? to) : '')
      record({
        kind: 'message',
        action: 'sent',
        target,
        ...(text ? { excerpt: excerpt(text) } : {}),
        undoable: false,
      })
      recorded++
    }
    if (recorded > 0) deps.onRecorded?.(p.threadId, p.turnId)
  }

  return {
    name: 'host.changeJournal',
    events: ['PreToolUse', 'PostToolUse'],
    async run(event, payload) {
      const { callId, turnId } = payload
      if (!callId) return
      if (event === 'PreToolUse') await before({ ...payload, callId })
      else if (event === 'PostToolUse' && turnId) await after({ ...payload, callId, turnId })
    },
  }
}
