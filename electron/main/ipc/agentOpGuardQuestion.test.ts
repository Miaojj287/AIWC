import type { ThreadId, ThreadOrigin } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { guardRendererOp, type OpGuardResult } from './agentOpGuard'

const desktopThread = 'thr_desktop' as ThreadId
const cronThread = 'thr_cron' as ThreadId
const origins: Record<string, ThreadOrigin> = {
  [desktopThread]: { channel: 'desktop' },
  [cronThread]: { channel: 'cron' },
}
const guard = (raw: unknown): Promise<OpGuardResult> =>
  guardRendererOp(raw, { lookupOrigin: async (id: ThreadId) => origins[id] })
const code = (r: OpGuardResult): string => (r.ok ? 'ok' : r.code)

describe('agent:submit guard — ask_user answers', () => {
  const base = { type: 'question.answer', threadId: desktopThread, questionId: 'qst_1' }

  it('accepts an option, free text or no answer, and nothing else', async () => {
    expect(code(await guard({ ...base, answer: { kind: 'option', index: 2, label: '李四' } }))).toBe('ok')
    expect(code(await guard({ ...base, answer: { kind: 'other', text: '都可以' } }))).toBe('ok')
    expect(code(await guard({ ...base, answer: { kind: 'dismissed' } }))).toBe('ok')
    expect(code(await guard({ ...base, answer: { kind: 'option', index: 5, label: 'x' } }))).toBe('invalid_op')
    expect(code(await guard({ ...base, answer: { kind: 'other', text: '   ' } }))).toBe('invalid_op')
    expect(code(await guard({ ...base, answer: { kind: 'dismissed', extra: 1 } }))).toBe('invalid_op')
  })

  it('may only answer desktop threads', async () => {
    expect(code(await guard({ ...base, threadId: cronThread, answer: { kind: 'dismissed' } }))).toBe('forbidden_thread')
  })
})
