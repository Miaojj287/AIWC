import { Check, ChevronDown, ChevronUp, CircleAlert, Circle, Clock } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ApprovalDecision, ApprovalId } from '@aiwc/protocol'
import { Badge, cn, ICON_STROKE, Spinner } from '@/kit'
import { ApprovalCard, safeJson } from '../ApprovalCard'
import { formatSeconds, type ApprovalRequest, type ThreadItem, type ToolCallView } from '../model'

export type ToolsItem = Extract<ThreadItem, { kind: 'tools' }>

export interface ToolCallGroupProps {
  item: ToolsItem
  pendingApprovals?: ApprovalRequest[]
  onResolveApproval?: (approvalId: ApprovalId, decision: ApprovalDecision) => void
}

/**
 * Tool-call group — one card per run of calls: status icon ✓ / ⟳ / ○ / ! , one-line summary, duration
 * right; awaiting rows carry the 等待确认 badge and an inline ApprovalCard underneath; click a row to see
 * its input / output as JSON in the mono face (Figma 150:1005). Never hidden inside a "thinking" fold
 * (CLAUDE.md §5). Only 高危 calls (发送 / 破坏性, plus 写入 in Ask 模式) ever wait here.
 */
export function ToolCallGroup({ item, pendingApprovals = [], onResolveApproval }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Only the oldest pending request owns the ⏎ / Esc keys; the rest queue behind it.
  const primaryApprovalId = pendingApprovals[0]?.approvalId
  return (
    <div className="flex w-full flex-col gap-[7px] rounded-item border border-line-6 bg-content px-2.5 py-2" data-item="tools">
      {item.calls.map((call) => {
        const request = call.status === 'awaiting_approval' ? pendingApprovals.find((a) => a.callId === call.callId || a.approvalId === call.approvalId) : undefined
        const open = Boolean(expanded[call.callId])
        return (
          <div key={call.callId} className="flex flex-col gap-1.5">
            <ToolRow call={call} expanded={open} onToggle={() => setExpanded((s) => ({ ...s, [call.callId]: !open }))} />
            {open ? <ToolDetail call={call} /> : null}
            {request && onResolveApproval ? (
              <ApprovalCard request={request} onResolve={onResolveApproval} primary={request.approvalId === primaryApprovalId} className="mt-0.5" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const STATUS_ICON: Record<ToolCallView['status'], ReactNode> = {
  pending: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  running: <Spinner size={13} label="进行中" />,
  awaiting_approval: <Clock size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-accent" />,
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  error: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
  denied: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  timeout: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-warn" />,
}

const STATUS_TEXT: Partial<Record<ToolCallView['status'], string>> = { error: '失败', denied: '已拒绝', timeout: '超时', pending: '等待中' }

const hasDetail = (call: ToolCallView) => (call.input !== null && call.input !== undefined) || call.output !== undefined

function ToolRow({ call, expanded, onToggle }: { call: ToolCallView; expanded: boolean; onToggle: () => void }) {
  const expandable = hasDetail(call)
  const right =
    call.status === 'awaiting_approval' ? (
      <Badge tone="accent">等待确认</Badge>
    ) : STATUS_TEXT[call.status] && call.status !== 'pending' ? (
      <span className={cn('font-latin text-micro', call.status === 'denied' ? 'text-fg-3' : call.status === 'timeout' ? 'text-warn' : 'text-danger')}>{STATUS_TEXT[call.status]}</span>
    ) : call.durationMs !== undefined ? (
      <span className="font-latin text-micro text-fg-3">{formatSeconds(call.durationMs)}</span>
    ) : call.status === 'running' && call.progress ? (
      <span className="max-w-[120px] truncate text-micro text-fg-3">{call.progress}</span>
    ) : null
  return (
    <div
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={expandable ? onToggle : undefined}
      onKeyDown={(e) => {
        if (!expandable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      data-status={call.status}
      className={cn(
        'group/row -mx-1 flex h-[22px] items-center gap-2 rounded-control px-1 outline-none',
        expandable && 'cursor-pointer hover:bg-hover-5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70',
        call.status === 'running' && 'text-fg',
      )}
    >
      <span className="flex size-[13px] shrink-0 items-center justify-center">{STATUS_ICON[call.status]}</span>
      <span className={cn('min-w-0 flex-1 truncate text-caption', call.status === 'awaiting_approval' || call.status === 'running' ? 'text-fg' : 'text-fg-2')} title={call.summary}>
        {call.summary}
      </span>
      {right}
      {expandable ? (
        <span className={cn('flex size-3 shrink-0 items-center justify-center text-fg-3', !expanded && 'opacity-0 group-hover/row:opacity-100')}>
          {expanded ? <ChevronUp size={12} strokeWidth={ICON_STROKE} aria-hidden /> : <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />}
        </span>
      ) : null}
    </div>
  )
}

function ToolDetail({ call }: { call: ToolCallView }) {
  return (
    <div className="flex flex-col gap-2 pl-[21px]">
      {call.input !== null && call.input !== undefined ? <KeyValue label="输入" value={safeJson(call.input)} /> : null}
      {call.output !== undefined ? <KeyValue label="输出" value={safeJson(call.output)} tone={call.isError ? 'danger' : undefined} /> : null}
      {call.artifacts?.length ? <div className="text-micro text-fg-3">生成 {call.artifacts.length} 个文件</div> : null}
    </div>
  )
}

function KeyValue({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro text-fg-3">{label}</span>
      <pre className={cn('m-0 max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded-control bg-line-4 px-2 py-1.5 font-mono text-micro leading-4 select-text', tone === 'danger' ? 'text-danger' : 'text-fg-2')}>{value}</pre>
    </div>
  )
}
