/**
 * Wording of everything 我的微信 sends to the owner's phone: the remote-control notices (stable codes from
 * @aiwc/gateway) and task-result pushes. Plain text in the UI language (mobile.phone.*); the Agent's own answer and
 * a task's summary are data and pass through untranslated.
 */
import type { RemoteNotice } from '@aiwc/gateway'
import type { TaskRun } from '@aiwc/protocol'
import { t } from './i18n'
import { localizeText } from './localizePayloads'

/** Longest task summary pushed to the phone; the run record on the computer keeps the rest. */
const TASK_SUMMARY_MAX_CHARS = 1200

const MODE_NAME = { ask: 'Ask', bypass: 'Bypass' } as const

const cap = (text: string, max: number): string => {
  const chars = Array.from(text.trim())
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : chars.join('')
}

function abortedText(reason: string): string {
  switch (reason) {
    case 'interrupted':
      return t('mobile.phone.aborted.interrupted')
    case 'step_cap':
      return t('mobile.phone.aborted.step_cap')
    case 'loop_guard':
      return t('mobile.phone.aborted.loop_guard')
    case 'timeout':
      return t('mobile.phone.aborted.timeout')
    case 'error':
      return t('mobile.phone.aborted.error')
    default:
      return t('mobile.phone.aborted.other')
  }
}

export function formatRemoteNotice(notice: RemoteNotice): string {
  switch (notice.kind) {
    case 'help':
      return t('mobile.phone.help')
    case 'status': {
      const lines = [t('mobile.phone.status.title')]
      if (!notice.hasThread) lines.push(t('mobile.phone.status.noThread'))
      else if (notice.running)
        lines.push(t('mobile.phone.status.running', { seconds: Math.round((notice.runningForMs ?? 0) / 1000) }))
      else lines.push(t('mobile.phone.status.idle'))
      if (notice.pending.length) {
        lines.push(t('mobile.phone.status.pendingHeader', { n: notice.pending.length }))
        for (const p of notice.pending) lines.push(t('mobile.phone.status.pendingItem', { summary: p.summary }))
      }
      if (notice.otherRunning || notice.otherPending)
        lines.push(t('mobile.phone.status.others', { running: notice.otherRunning, pending: notice.otherPending }))
      lines.push(t('mobile.phone.status.mode', { mode: MODE_NAME[notice.permissionMode] }))
      return lines.join('\n')
    }
    case 'stopped':
      return t('mobile.phone.stopped')
    case 'nothingToStop':
      return t('mobile.phone.nothingToStop')
    case 'newThread':
      return t('mobile.phone.newThread')
    case 'steered':
      return t('mobile.phone.steered')
    case 'approval': {
      const lines = [
        notice.reminder ? t('mobile.phone.approval.reminderHeader') : t('mobile.phone.approval.header'),
        notice.summary,
      ]
      if (notice.detail) lines.push(notice.detail)
      lines.push(
        t('mobile.phone.approval.riskLine', { risk: t(`mobile.phone.approval.risk.${notice.risk}`) }),
        '',
        t('mobile.phone.approval.allowOnce'),
      )
      if (notice.canAllowAlways) lines.push(t('mobile.phone.approval.allowAlways'))
      lines.push(t('mobile.phone.approval.deny'), t('mobile.phone.approval.reply'))
      if (notice.queued > 0) lines.push(t('mobile.phone.approval.queued', { n: notice.queued }))
      return lines.join('\n')
    }
    case 'approvalAnswered':
      return t(`mobile.phone.answered.${notice.decision}`)
    case 'approvalElsewhere':
      return t(`mobile.phone.elsewhere.${notice.decision}`)
    case 'approvalNoAlways':
      return t('mobile.phone.noAlways')
    case 'reply':
      return notice.truncated ? `${notice.text}\n${t('mobile.phone.truncated')}` : notice.text
    case 'doneEmpty':
      return t('mobile.phone.doneEmpty')
    case 'aborted':
      return abortedText(notice.reason)
    case 'failed':
      return t('mobile.phone.failed', { message: localizeText(notice.message) })
    case 'unsupported':
      return t('mobile.phone.unsupported')
    case 'disabled':
      return t('mobile.phone.disabled')
  }
}

/** The phone message for a finished run, or undefined for states that are not a result (running, skipped…). */
export function formatTaskPush(run: TaskRun, taskName: string): string | undefined {
  if (run.status === 'done') {
    const header = run.denied.length
      ? t('mobile.phone.task.doneWithDenied', { name: taskName, n: run.denied.length })
      : t('mobile.phone.task.done', { name: taskName })
    const summary = run.summary?.trim() ? cap(run.summary, TASK_SUMMARY_MAX_CHARS) : t('mobile.phone.task.noSummary')
    return `${header}\n${summary}`
  }
  if (run.status === 'failed') {
    const header = t('mobile.phone.task.failed', { name: taskName })
    const reason = run.error?.trim() ? cap(localizeText(run.error), 300) : run.reason
    return reason ? `${header}\n${t('mobile.phone.task.reason', { reason })}` : header
  }
  return undefined
}
