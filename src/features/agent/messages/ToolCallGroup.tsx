import { Ban, Bot, ChevronRight, CircleAlert, Clock, Pencil, Search, Send, Trash2 } from 'lucide-react'
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useT, type MessageKey } from '@/i18n'
import { Badge, cn, ICON_STROKE, type IconComponent } from '@/kit'
import { safeJson } from '../ApprovalCard'
import { isHiddenCall, type ExploreMember } from '../exploreRuns'
import { formatSeconds, type ThreadItem, type ToolCallView } from '../model'
import { toolCardFor, toolIconFor } from '../toolCards'
import { toolCallLabel } from '../toolSummaries'
import { ReasoningSection } from './ReasoningSection'

export type ToolsItem = Extract<ThreadItem, { kind: 'tools' }>

export interface ToolCallGroupProps {
  item: ToolsItem
  /** The turn is still running: unfinished calls shimmer. A finished turn's leftovers (history) stay still. */
  active?: boolean
}

/**
 * Tool calls as flat rows on the conversation canvas: kind icon, one-line summary worded in the UI language
 * (toolSummaries.ts; shimmering while it runs, filling in while the model still writes the arguments) and, on hover,
 * the duration and the expand chevron. Runs of read-only calls are folded into 查阅 rows by the turn
 * (exploreRuns.ts → ExploreGroup). Awaiting rows carry 等待确认; the request itself is answered in the composer slot
 * (ApprovalCard). Expand a row for its input / output, or for the tool's own detail card (a command and its output).
 */
export function ToolCallGroup({ item, active = false }: ToolCallGroupProps) {
  const calls = item.calls.filter((c) => !isHiddenCall(c))
  if (calls.length === 0) return null
  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-item="tools">
      {calls.map((call) => (
        <ToolRow key={call.callId} call={call} active={active} />
      ))}
    </div>
  )
}

/** One word per status: shown for the states that need attention, visually hidden for the rest. */
const STATUS_TEXT: Record<ToolCallView['status'], MessageKey> = {
  pending: 'agent.tool.status.pending',
  running: 'agent.tool.status.running',
  awaiting_approval: 'agent.tool.awaitingApproval',
  done: 'agent.tool.status.done',
  error: 'agent.tool.status.error',
  denied: 'agent.tool.status.denied',
  timeout: 'agent.tool.status.timeout',
}

const SPELLED_OUT: ReadonlySet<ToolCallView['status']> = new Set(['awaiting_approval', 'error', 'denied', 'timeout'])

const isLive = (call: ToolCallView) => call.status === 'running' || call.status === 'pending'

/** What kind of step it is: the icon its card registered (a terminal for `shell`), else its declared risk's. */
function kindIcon(call: ToolCallView): IconComponent {
  if (call.kind === 'subagent') return Bot
  const own = toolIconFor(call.toolName)
  if (own) return own
  switch (call.risk) {
    case 'read':
      return Search
    case 'write':
      return Pencil
    case 'send':
      return Send
    case 'destructive':
      return Trash2
  }
}

function statusIcon(call: ToolCallView): { icon: IconComponent; className: string } {
  switch (call.status) {
    case 'error':
      return { icon: CircleAlert, className: 'text-danger' }
    case 'timeout':
      return { icon: CircleAlert, className: 'text-warn' }
    case 'denied':
      return { icon: Ban, className: 'text-fg-3' }
    case 'awaiting_approval':
      return { icon: Clock, className: 'text-accent' }
    case 'pending':
    case 'running':
    case 'done':
      return { icon: kindIcon(call), className: 'text-fg-3' }
  }
}

const hasDetail = (call: ToolCallView) =>
  toolCardFor(call.toolName)?.placement === 'detail' ||
  (call.input !== null && call.input !== undefined) ||
  Boolean(call.inputText) ||
  call.output !== undefined

function onActivate(e: KeyboardEvent<HTMLElement>, run: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    run()
  }
}

/** The clickable line shared by tool rows and the 查阅 group: icon, label, trailing meta, hover chevron. */
function RowLine({
  icon: Icon,
  iconClassName,
  expandable,
  expanded,
  controls,
  onToggle,
  status,
  children,
  meta,
}: {
  icon: IconComponent
  iconClassName: string
  expandable: boolean
  expanded: boolean
  controls: string
  onToggle: () => void
  status?: ToolCallView['status']
  children: ReactNode
  meta?: ReactNode
}) {
  return (
    <div
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
      aria-controls={expandable ? controls : undefined}
      onClick={expandable ? onToggle : undefined}
      onKeyDown={expandable ? (e) => onActivate(e, onToggle) : undefined}
      data-status={status}
      className={cn(
        'group/tool -mx-1 flex min-h-7 min-w-0 max-w-full items-center gap-2 self-start rounded-control px-1 text-body outline-none',
        expandable && 'cursor-pointer',
      )}
    >
      <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden className={cn('shrink-0', iconClassName)} />
      {children}
      {meta}
      {expandable ? (
        <ChevronRight
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn(
            'shrink-0 text-fg-3 opacity-0 transition-[opacity,transform] group-hover/tool:opacity-100 group-focus-visible/tool:opacity-100',
            expanded && 'rotate-90 opacity-100',
          )}
        />
      ) : null}
    </div>
  )
}

function ToolRow({ call, active }: { call: ToolCallView; active: boolean }) {
  const t = useT()
  const label = toolCallLabel(call, t)
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const registered = toolCardFor(call.toolName)
  const expandable = hasDetail(call)
  const live = active && isLive(call)
  const { icon, className: iconClassName } = statusIcon(call)
  const spelledOut = SPELLED_OUT.has(call.status)
  const Inline = registered?.placement === 'inline' ? registered.card : undefined
  const meta =
    call.status === 'awaiting_approval' ? (
      <Badge tone="accent">{t(STATUS_TEXT[call.status])}</Badge>
    ) : spelledOut ? (
      <span
        className={cn(
          'shrink-0 text-caption',
          call.status === 'denied' ? 'text-fg-3' : call.status === 'timeout' ? 'text-warn-ink' : 'text-danger-ink',
        )}
      >
        {t(STATUS_TEXT[call.status])}
      </span>
    ) : (
      <>
        <span className="sr-only">{t(STATUS_TEXT[call.status])}</span>
        {call.status === 'running' && call.progress ? (
          <span className="min-w-0 max-w-[160px] shrink truncate text-caption text-fg-3">{call.progress}</span>
        ) : call.durationMs !== undefined ? (
          <span className="shrink-0 font-latin text-caption text-fg-3 opacity-0 transition-opacity group-hover/tool:opacity-100 group-focus-visible/tool:opacity-100">
            {formatSeconds(call.durationMs)}
          </span>
        ) : null}
      </>
    )
  return (
    <div className="flex min-w-0 flex-col">
      <RowLine
        icon={icon}
        iconClassName={iconClassName}
        expandable={expandable}
        expanded={expanded}
        controls={detailId}
        onToggle={() => setExpanded(!expanded)}
        status={call.status}
        meta={meta}
      >
        <span
          title={label}
          className={cn(
            'min-w-0 truncate',
            live ? 'kit-shimmer font-medium text-fg-2' : call.status === 'awaiting_approval' ? 'text-fg' : 'text-fg-2',
          )}
        >
          {label}
        </span>
      </RowLine>
      {expanded ? (
        <div id={detailId} className="ml-[7px] mt-1 mb-1 border-l border-line-8 pl-3.5">
          {registered?.placement === 'detail' ? <registered.card call={call} /> : <ToolDetail call={call} />}
        </div>
      ) : null}
      {Inline ? (
        <div className="mt-1.5">
          <Inline call={call} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * A run of read-only calls (exploreRuns.ts): one 查阅 line that names the newest step while it works; open it for the
 * individual steps and the thinking between them.
 */
export function ExploreGroup({ members, active }: { members: ExploreMember[]; active: boolean }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const calls = members.flatMap((m) => (m.kind === 'call' ? [m.call] : []))
  const live = active && calls.some(isLive)
  const failed = calls.filter((c) => c.status === 'error' || c.status === 'timeout').length
  const latest = [...calls].reverse().find(isLive) ?? calls[calls.length - 1]
  const summary = live
    ? latest
      ? toolCallLabel(latest, t)
      : ''
    : failed
      ? t('agent.tool.group.stepsFailed', { n: calls.length, failed })
      : t('agent.tool.group.steps', { n: calls.length })
  return (
    <div className="flex min-w-0 flex-col" data-item="explore">
      <RowLine
        icon={failed && !live ? CircleAlert : Search}
        iconClassName={failed && !live ? 'text-danger' : 'text-fg-3'}
        expandable
        expanded={expanded}
        controls={listId}
        onToggle={() => setExpanded(!expanded)}
      >
        <span className={cn('shrink-0 font-medium', live ? 'kit-shimmer text-fg-2' : 'text-fg-2')}>
          {t(live ? 'agent.tool.group.exploring' : 'agent.tool.group.explored')}
        </span>
        <span aria-hidden className="shrink-0 text-fg-3">
          ·
        </span>
        <span title={summary} className="min-w-0 truncate text-fg-3">
          {summary}
        </span>
      </RowLine>
      {expanded ? (
        <div id={listId} className="ml-[7px] mt-1 mb-1 flex flex-col gap-0.5 border-l border-line-8 pl-3.5">
          {members.map((m) =>
            m.kind === 'call' ? (
              <ToolRow key={m.call.callId} call={m.call} active={active} />
            ) : (
              <ReasoningSection key={m.item.id} text={m.item.reasoning ?? ''} active={false} />
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

function ToolDetail({ call }: { call: ToolCallView }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2.5 py-1">
      {call.inputText !== undefined && (call.input === null || call.input === undefined) ? (
        <KeyValue label={t('agent.tool.input')} value={call.inputText} />
      ) : call.input !== null && call.input !== undefined ? (
        <KeyValue label={t('agent.tool.input')} value={safeJson(call.input)} />
      ) : null}
      {call.output !== undefined ? (
        <KeyValue
          label={t('agent.tool.output')}
          value={safeJson(call.output)}
          tone={call.isError ? 'danger' : undefined}
        />
      ) : null}
      {call.artifacts?.length ? (
        <div className="text-micro text-fg-3">{t('agent.tool.generatedFiles', { n: call.artifacts.length })}</div>
      ) : null}
    </div>
  )
}

function KeyValue({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro font-medium text-fg-3">{label}</span>
      <pre
        className={cn(
          'm-0 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-item px-2.5 py-2 font-mono text-micro leading-4 select-text',
          tone === 'danger' ? 'bg-danger/8 text-danger-ink' : 'bg-line-4 text-fg-2',
        )}
      >
        {value}
      </pre>
    </div>
  )
}
