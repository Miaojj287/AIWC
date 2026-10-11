import { describe, expect, it } from 'vitest'
import type { ScheduledTask, TaskRun } from '@aiwc/protocol'
import { t } from '@/i18n'
import { runRecoveryLines } from './editor/RunRecovery'
import { describeSchedule, nextWholeHour, taskStatusLine, validateDraft, emptyDraft } from './scheduleModel'

const run = (patch: Partial<TaskRun>): TaskRun => ({
  id: 'r',
  taskId: 't',
  trigger: 'schedule',
  status: 'done',
  startedAt: new Date(2030, 0, 15, 11, 0).getTime(),
  denied: [],
  toolCalls: 0,
  ...patch,
})

describe('task recovery copy', () => {
  it('explains missed, caught-up, failed and retried runs', () => {
    const due = new Date(2030, 0, 15, 9, 0).getTime()
    expect(
      runRecoveryLines(run({ status: 'missed', reason: 'app_not_running', scheduledFor: due, missedCount: 2 }), t)[0],
    ).toMatch(/错过 2 次 · 应用没有运行/)
    expect(runRecoveryLines(run({ trigger: 'catch_up', reason: 'machine_asleep', scheduledFor: due }), t)[0]).toMatch(
      /^补跑原定/,
    )
    const failed = runRecoveryLines(run({ status: 'failed', reason: 'rate_limited', retryAt: due, maxAttempts: 2 }), t)
    expect(failed).toEqual(['服务商限流', expect.stringMatching(/自动重试（第 1\/2 次）/)])
    expect(runRecoveryLines(run({ trigger: 'retry', attempt: 1, maxAttempts: 2 }), t)).toEqual(['第 1/2 次重试'])
    expect(runRecoveryLines(run({ status: 'interrupted', reason: 'app_quit' }), t)).toEqual(['运行时应用退出了'])
    expect(runRecoveryLines(run({}), t)).toEqual([])
  })

  it('handles one-shot schedules', () => {
    const now = new Date(2030, 0, 15, 8, 20).getTime()
    expect(nextWholeHour(now)).toBe(new Date(2030, 0, 15, 9, 0).getTime())
    expect(describeSchedule({ kind: 'once', at: nextWholeHour(now) }, t)).toMatch(/一次$/)
    const draft = { ...emptyDraft(), name: 'n', prompt: 'p', schedule: { kind: 'once' as const, at: now - 1 } }
    expect(validateDraft(draft, t, now).at).toBe('请选择将来的时间')
    expect(validateDraft({ ...draft, enabled: false }, t, now).at).toBeUndefined()
    const done: ScheduledTask = {
      id: 't',
      name: 'n',
      prompt: 'p',
      schedule: { kind: 'once', at: now - 1 },
      enabled: false,
      permissionMode: 'bypass',
      action: 'remind',
      catchUp: 'once',
      createdAt: 0,
      updatedAt: 0,
      lastRunAt: now - 1,
      lastRunStatus: 'done',
    }
    expect(taskStatusLine(done, t, now).text).toMatch(/完成/)
  })
})
