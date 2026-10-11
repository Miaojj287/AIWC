/**
 * What raises a system notification, and with which words (services/systemNotifier.ts decides whether to show it).
 * Approvals are watched here on the kernel's event stream; drafts, a paused auto reply and task runs are reported by
 * the places that already toast them. Bodies leave contact names out unless the user turned them on: the lock screen
 * and the notification centre keep the text.
 */
import type { Event, TaskRun } from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'
import { t } from './i18n'
import { localizeText } from './localizePayloads'
import type { AttentionNotice } from './services/systemNotifier'

export interface AttentionNoticesDeps {
  /** Hands a notice to the system notifier; absent in tests and headless runs. */
  attention?: (notice: AttentionNotice) => void
  /** 设置 › 常规 › 系统通知 › 显示联系人名称. */
  showNames(): boolean
  kernel: Pick<Kernel, 'events' | 'getThread'>
  logger?: (level: 'debug', msg: string, meta?: unknown) => void
}

export interface AttentionNotices {
  /** 自动回复 (确认后发) parked a reply for this chat. */
  replyDraft(chat: { sessionId: string; name?: string }): void
  /** draft_reply put an Agent-written reply into the reply desk. */
  agentDraft(name: string | undefined): void
  autoReplyHalted(): void
  taskRun(run: TaskRun, taskName: string): void
  dispose(): void
}

export function createAttentionNotices(deps: AttentionNoticesDeps): AttentionNotices {
  const send = (notice: AttentionNotice): void => deps.attention?.(notice)
  const named = (name: string | undefined): name is string => Boolean(name && deps.showNames())

  // Only desktop threads have someone to answer; a bot / cron thread never waits on the user here.
  const approval = async (e: Extract<Event, { type: 'approval.requested' }>): Promise<void> => {
    try {
      const origin = (await deps.kernel.getThread(e.threadId))?.record.origin
      if (origin?.channel !== 'desktop') return
    } catch (err) {
      deps.logger?.('debug', 'approval notice: thread lookup failed', { err: String(err) })
      return
    }
    send({
      key: `approval:${e.approvalId}`,
      title: t('main.notify.approval.title'),
      body: deps.showNames() ? localizeText(e.summary) : t('main.notify.approval.body'),
      action: { command: 'agent.openThread', payload: { threadId: e.threadId } },
    })
  }
  const off = deps.attention
    ? deps.kernel.events.on((e) => {
        if (e.type === 'approval.requested') void approval(e)
        // ask_user only ever waits in a desktop thread (the kernel refuses it elsewhere).
        if (e.type === 'question.requested')
          send({
            key: `question:${e.questionId}`,
            title: t('main.notify.question.title'),
            body: deps.showNames() ? e.question : t('main.notify.question.body'),
            action: { command: 'agent.openThread', payload: { threadId: e.threadId } },
          })
      })
    : () => {}

  return {
    replyDraft({ sessionId, name }) {
      send({
        key: `reply-draft:${sessionId}`,
        title: t('main.notify.replyDraft.title'),
        body: named(name) ? t('main.notify.replyDraft.bodyNamed', { name }) : t('main.notify.replyDraft.body'),
        action: { command: 'tab.openAutoReply', payload: { sessionId, title: name ?? sessionId } },
      })
    },
    agentDraft(name) {
      send({
        key: 'agent-draft',
        title: t('main.notify.agentDraft.title'),
        body: named(name) ? t('main.notify.agentDraft.bodyNamed', { name }) : t('main.notify.agentDraft.body'),
        action: { command: 'tab.openReplyDesk' },
      })
    },
    autoReplyHalted() {
      send({
        key: 'autoreply-halted',
        title: t('main.notify.halted.title'),
        body: t('main.notify.halted.body'),
        action: { command: 'tab.openReplyDesk' },
      })
    },
    taskRun(run, taskName) {
      if (run.status !== 'done' && run.status !== 'failed') return
      const failed = run.status === 'failed'
      send({
        key: `task:${run.id}`,
        title: failed
          ? t('main.notify.task.failedTitle', { name: taskName })
          : t('main.notify.task.doneTitle', { name: taskName }),
        body: failed
          ? t('main.notify.task.failed')
          : run.denied.length > 0
            ? t('main.notify.task.doneWithDenied', { n: run.denied.length })
            : t('main.notify.task.done'),
        action: { command: 'tab.openTask', payload: { id: run.taskId } },
      })
    },
    dispose: off,
  }
}
