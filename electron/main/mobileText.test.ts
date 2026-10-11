import { afterEach, describe, expect, it } from 'vitest'
import type { TaskRun } from '@aiwc/protocol'
import { setMainLanguage } from './i18n'
import { formatRemoteNotice, formatTaskPush } from './mobileText'

afterEach(() => setMainLanguage('zh-CN'))

const approval = {
  kind: 'approval' as const,
  summary: 'git commit -m fix',
  risk: 'write' as const,
  canAllowAlways: true,
  queued: 0,
  reminder: false,
}

describe('formatRemoteNotice', () => {
  it('numbers the approval options 1 / 2 / 3', () => {
    const text = formatRemoteNotice(approval)
    expect(text).toContain('git commit -m fix')
    expect(text).toMatch(/1 允许一次[\s\S]*2 总是允许[\s\S]*3 拒绝/)
  })

  it('leaves out "2" when the call cannot be allowed always, keeping 3 for deny', () => {
    const text = formatRemoteNotice({ ...approval, risk: 'send', canAllowAlways: false, queued: 2 })
    expect(text).not.toContain('2 总是允许')
    expect(text).toContain('3 拒绝')
    expect(text).toContain('后面还有 2 个待确认')
  })

  it('words the status and the truncated reply', () => {
    const status = formatRemoteNotice({
      kind: 'status',
      hasThread: true,
      running: true,
      runningForMs: 12_400,
      pending: [{ summary: 'rm x', risk: 'destructive' }],
      otherRunning: 1,
      otherPending: 0,
      permissionMode: 'ask',
    })
    expect(status).toContain('运行中（12 秒）')
    expect(status).toContain('· rm x')
    expect(status).toContain('Ask')
    expect(formatRemoteNotice({ kind: 'reply', text: 'abc', truncated: true })).toMatch(/^abc\n…/)
    expect(formatRemoteNotice({ kind: 'reply', text: 'abc', truncated: false })).toBe('abc')
  })

  it('follows the UI language', () => {
    setMainLanguage('en-US')
    expect(formatRemoteNotice(approval)).toMatch(/1 Allow once[\s\S]*2 Always allow[\s\S]*3 Deny/)
    expect(formatRemoteNotice({ kind: 'approvalAnswered', decision: 'deny' })).toBe('Denied.')
    expect(formatRemoteNotice({ kind: 'help' })).toContain('/status')
  })
})

describe('formatTaskPush', () => {
  const run = (over: Partial<TaskRun>): TaskRun => ({
    id: 'r',
    taskId: 't',
    trigger: 'schedule',
    status: 'done',
    startedAt: 1,
    denied: [],
    toolCalls: 0,
    ...over,
  })

  it('caps long summaries', () => {
    const text = formatTaskPush(run({ summary: '长'.repeat(5000) }), '晨报')!
    expect(text.startsWith('【定时任务】晨报 已完成\n')).toBe(true)
    expect(Array.from(text).length).toBeLessThan(1300)
  })

  it('mentions denied calls and failures', () => {
    expect(
      formatTaskPush(run({ summary: 's', denied: [{ tool: 'x', key: 'x', risk: 'send', summary: 'x' }] }), 'A'),
    ).toContain('1 个操作被权限模式跳过')
    expect(formatTaskPush(run({ status: 'failed', error: 'boom' }), 'A')).toBe('【定时任务】A 失败\n原因：boom')
  })

  it('has nothing to say for runs that are not a result', () => {
    expect(formatTaskPush(run({ status: 'running' }), 'A')).toBeUndefined()
    expect(formatTaskPush(run({ status: 'skipped' }), 'A')).toBeUndefined()
  })
})
