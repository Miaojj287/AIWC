/**
 * What a sub-agent did, under the tool row that runs it (delegate_analysis; a workflow_run step in WorkflowCard):
 * one line per child — label, ⟳ / ✓ / !, how many actions — that opens to the child's own tool rows and replies
 * (live while it runs, from its recorded trace after a reload), plus 查看子代理记录 to read the whole log in a
 * workspace tab. Read-only: the child's approvals are answered in the parent's composer as usual.
 */
import { ChevronRight, CircleAlert, CircleCheck, PanelRightOpen } from 'lucide-react'
import { useId, useState } from 'react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { cn, ICON_STROKE, IconButton, Spinner, Tooltip } from '@/kit'
import { groupWork } from '../exploreRuns'
import { formatSeconds, type SubagentRun, type ThreadItem } from '../model'
import type { ToolCardProps } from '../toolCards'
import { AssistantMessage } from './AssistantMessage'
import { PlanCard } from './Notices'
import { ExploreGroup, ToolCallGroup } from './ToolCallGroup'

/** Entries of a child's transcript shown inline; the log tab has the rest. */
const INLINE_ENTRIES = 8

/** Actions a run took (tool calls and replies), for the row's count. */
export function runActionCount(run: SubagentRun): number {
  let n = run.omitted ?? 0
  for (const it of run.items) {
    if (it.kind === 'tools') n += it.calls.length
    else if (it.kind === 'assistant' && it.text.trim()) n++
  }
  return n
}

/** The child's transcript, compact: grouped tool rows, replies and its plan. */
export function ChildTranscript({ items, active, limit }: { items: ThreadItem[]; active: boolean; limit?: number }) {
  const entries = groupWork(items)
  const shown = limit !== undefined && entries.length > limit ? entries.slice(-limit) : entries
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {shown.map((entry) => {
        if (entry.kind === 'explore') return <ExploreGroup key={entry.id} members={entry.members} active={active} />
        const item = entry.item
        switch (item.kind) {
          case 'tools':
            return <ToolCallGroup key={`${item.id}:${item.calls[0]?.callId ?? ''}`} item={item} active={active} />
          case 'assistant':
            return item.text.trim() || item.reasoning?.trim() ? <AssistantMessage key={item.id} item={item} /> : null
          case 'plan':
            return <PlanCard key={item.id} item={item} />
          default:
            return null
        }
      })}
    </div>
  )
}

function RunStatusIcon({ run }: { run: SubagentRun }) {
  if (run.status === 'running') return <Spinner size={12} className="shrink-0" />
  const Icon = run.status === 'done' ? CircleCheck : CircleAlert
  return (
    <Icon
      size={12}
      strokeWidth={ICON_STROKE}
      aria-hidden
      className={cn('shrink-0', run.status === 'done' ? 'text-ok' : 'text-danger')}
    />
  )
}

/** Opens the child's whole log in the workspace (CLAUDE.md §1: everything opens as a Tab). */
export function OpenRunLog({ run }: { run: SubagentRun }) {
  const t = useT()
  return (
    <Tooltip content={t('agent.subagent.open')}>
      <IconButton
        size="xs"
        icon={PanelRightOpen}
        label={t('agent.subagent.open')}
        onClick={(e) => {
          e.stopPropagation()
          runCommand('tab.openAgentRun', { childId: run.childId, label: run.label })
        }}
        className="text-fg-3 opacity-0 group-hover/run:opacity-100 focus-visible:opacity-100"
      />
    </Tooltip>
  )
}

export function SubagentRunRow({ run, title }: { run: SubagentRun; title?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const live = run.status === 'running'
  const actions = runActionCount(run)
  const label = title ?? run.label
  return (
    <li className="flex min-w-0 flex-col">
      <div className="group/run flex min-h-6 min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control text-left text-caption outline-none"
        >
          <RunStatusIcon run={run} />
          <span className="sr-only">
            {t(
              live
                ? 'agent.tool.status.running'
                : run.status === 'done'
                  ? 'agent.tool.status.done'
                  : 'agent.tool.status.error',
            )}
          </span>
          <span
            title={label}
            className={cn('min-w-0 truncate', live ? 'kit-shimmer font-medium text-fg-2' : 'text-fg-2')}
          >
            {label}
          </span>
          {actions > 0 ? (
            <span className="shrink-0 text-micro text-fg-3">{t('agent.subagent.actions', { n: actions })}</span>
          ) : null}
          {!live && run.durationMs !== undefined ? (
            <span className="shrink-0 font-latin text-micro text-fg-3">{formatSeconds(run.durationMs)}</span>
          ) : null}
          <ChevronRight
            size={12}
            strokeWidth={ICON_STROKE}
            aria-hidden
            className={cn(
              'shrink-0 text-fg-3 opacity-0 transition-[opacity,transform] group-hover/run:opacity-100',
              open && 'rotate-90 opacity-100',
            )}
          />
        </button>
        <OpenRunLog run={run} />
      </div>
      {open ? (
        <div id={bodyId} className="ml-[5px] mt-1 mb-1 border-l border-line-8 pl-3.5">
          {run.items.length === 0 ? (
            <span className="text-caption text-fg-3">{t('agent.subagent.noActivity')}</span>
          ) : (
            <ChildTranscript items={run.items} active={live} limit={INLINE_ENTRIES} />
          )}
        </div>
      ) : null}
    </li>
  )
}

/** delegate_analysis under its row: its children, each with its own transcript. */
export function DelegateCard({ call }: ToolCardProps) {
  const t = useT()
  const runs = call.children ?? []
  if (runs.length === 0) return null
  return (
    <ul
      aria-label={t('agent.subagent.label')}
      className="m-0 ml-[7px] flex list-none flex-col gap-0.5 border-l border-line-8 p-0 pl-3.5"
    >
      {runs.map((run) => (
        <SubagentRunRow key={run.childId} run={run} />
      ))}
    </ul>
  )
}
