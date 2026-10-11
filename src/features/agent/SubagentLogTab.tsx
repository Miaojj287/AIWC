/**
 * 子代理记录 — a sub-agent's whole log as a read-only workspace Tab (kind 'agentRun', objectId = child id), opened
 * from its line under the delegate / workflow row. It reads the run from the conversation that holds it, so it keeps
 * updating while the sub-agent works; once that conversation is closed the log is gone from memory and the tab says
 * so, offering to reopen the conversation.
 */
import { asThreadId } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { Button, EmptyState } from '@/kit'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { useAgentStore } from './agentStore'
import { MessageList } from './MessageList'
import { findSubagentRun } from './subagentLookup'

export function SubagentLogTab({ tab }: TabRendererProps) {
  const t = useT()
  const found = useAgentStore((s) => findSubagentRun(s.views, tab.objectId))
  const savedThread = typeof tab.state?.threadId === 'string' ? tab.state.threadId : undefined
  if (!found) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          variant="error"
          title={t('agent.subagent.unavailable')}
          description={t('agent.subagent.unavailableDescription')}
          action={
            savedThread
              ? {
                  label: t('agent.subagent.openConversation'),
                  onClick: () => runCommand('agent.openThread', { threadId: savedThread }),
                }
              : undefined
          }
        />
      </div>
    )
  }
  const { run, threadId } = found
  return (
    <div className="flex h-full min-h-0 flex-col bg-content" data-tab="agent-run">
      <header className="flex min-h-18 shrink-0 items-center gap-3 border-b border-line-6 px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span title={run.label} className="min-w-0 truncate text-bubble font-semibold leading-5 text-fg">
            {run.label}
          </span>
          <span className="truncate text-caption text-fg-3">{t('agent.subagent.readOnly')}</span>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            useAgentStore.getState().openThread(asThreadId(threadId))
            runCommand('agent.expand')
          }}
        >
          {t('agent.subagent.openConversation')}
        </Button>
      </header>
      {run.omitted ? (
        <p className="m-0 px-5 pt-3 text-caption text-fg-3">{t('agent.subagent.omitted', { n: run.omitted })}</p>
      ) : null}
      <MessageList
        className="min-h-0 flex-1"
        items={run.items}
        streaming={run.status === 'running'}
        emptyState={<EmptyState variant="empty" title={t('agent.subagent.noActivity')} compact />}
      />
    </div>
  )
}
