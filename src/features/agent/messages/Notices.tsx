/**
 * Small in-stream pieces: compaction bar, aborted notice, plan card, streaming indicator,
 * suggestion buttons and the empty-thread state (Figma 150:1056 / 1095 / 1116).
 */
import { Check, Circle, CircleAlert, Clock, Layers, Sparkles, Square } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, cn, EmptyState, ICON_STROKE, Spinner } from '@/kit'
import { formatSeconds, formatTokens, type PlanStepStatus, type ThreadItem } from '../model'

export type CompactionItem = Extract<ThreadItem, { kind: 'compaction' }>
export type AbortedItem = Extract<ThreadItem, { kind: 'aborted' }>
export type PlanItem = Extract<ThreadItem, { kind: 'plan' }>

export function CompactionNotice({ item, onViewSummary }: { item: CompactionItem; onViewSummary?: (item: CompactionItem) => void }) {
  const text = item.freedTokens !== undefined ? `上下文已压缩 · 释放 ${formatTokens(item.freedTokens)} tokens` : item.foldedItemCount ? `上下文已压缩 · 折叠 ${item.foldedItemCount} 条` : '上下文已压缩'
  return (
    <div data-item="compaction" className="flex h-[26px] w-full items-center gap-2 rounded-control bg-hover-5 pl-2.5 pr-1">
      <Layers size={12} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      <span className="min-w-0 flex-1 truncate text-caption text-fg-2">{text}</span>
      {onViewSummary ? (
        <Button variant="link" size="sm" onClick={() => onViewSummary(item)} className="h-5 px-1.5 text-caption">
          查看摘要
        </Button>
      ) : null}
    </div>
  )
}

const ABORT_TEXT: Record<AbortedItem['reason'], string> = {
  interrupted: '已停止生成',
  replaced: '已被新的请求替代',
  step_cap: '已达到本轮步数上限',
  loop_guard: '检测到重复调用，已停止',
  timeout: '本轮超时，已停止',
  error: '本轮出错，已停止',
}

export function AbortedNotice({ item }: { item: AbortedItem }) {
  return (
    <div data-item="aborted" className="flex w-full items-center justify-center py-0.5 text-micro text-fg-3">
      {ABORT_TEXT[item.reason]}
    </div>
  )
}

const PLAN_ICON: Record<PlanStepStatus, ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  doing: <Spinner size={13} label="进行中" />,
  todo: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

export function PlanCard({ item }: { item: PlanItem }) {
  const done = item.steps.filter((s) => s.status === 'done').length
  return (
    <div data-item="plan" className="flex w-full flex-col gap-1.5 rounded-item border border-line-6 bg-content px-2.5 py-2">
      <div className="flex items-center justify-between text-micro text-fg-3">
        <span>计划</span>
        <span className="font-latin">
          {done} / {item.steps.length}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {item.steps.map((s, i) => (
          <li key={i} data-status={s.status} className="flex h-[22px] items-center gap-2">
            <span className="flex size-[13px] shrink-0 items-center justify-center">{PLAN_ICON[s.status]}</span>
            <span className={cn('min-w-0 flex-1 truncate text-caption', s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger' : 'text-fg-2')}>{s.title}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * 正在生成 · 已用 4.1s + 停止生成. `since` is the turn start time. While a 二次确认 is open the turn is
 * not generating but blocked on the user, so the row says so and points at the card above it.
 */
export function StreamingIndicator({ since, onStop, awaitingApproval = false }: { since?: number; onStop?: () => void; awaitingApproval?: boolean }) {
  const [elapsed, setElapsed] = useState(() => (since ? Date.now() - since : 0))
  useEffect(() => {
    if (!since || awaitingApproval) return
    setElapsed(Date.now() - since)
    const id = setInterval(() => setElapsed(Date.now() - since), 100)
    return () => clearInterval(id)
  }, [since, awaitingApproval])
  return (
    <div data-item="streaming" className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-1.5 text-caption text-fg-2" role="status">
        {awaitingApproval ? (
          <>
            <Clock size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-accent" />
            <span>已暂停，等待你确认上面的操作</span>
          </>
        ) : (
          <>
            <Spinner size={13} label="正在生成" />
            <span>正在生成{since ? ` · 已用 ${formatSeconds(elapsed)}` : ''}</span>
          </>
        )}
      </div>
      {onStop ? (
        <div>
          <Button variant="ghost" icon={Square} onClick={onStop}>
            停止生成
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function Suggestions({ items, onPick, className }: { items: string[]; onPick: (text: string) => void; className?: string }) {
  if (items.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-1.5', className)} data-item="suggestions">
      {items.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-control bg-hover-5 px-3 text-caption text-fg-2 outline-none transition-colors hover:bg-hover-7 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <Sparkles size={11} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-accent" />
          <span className="truncate">{s}</span>
        </button>
      ))}
    </div>
  )
}

/** Empty thread: sparkles box, 新会话, hint and up to three suggested prompts (Figma 150:1095). */
export function EmptyThread({ suggestions = [], onPick, title = '新会话' }: { suggestions?: string[]; onPick: (text: string) => void; title?: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-4">
      <EmptyState icon={Sparkles} title={title} description={suggestions.length ? '问我关于微信数据的任何问题，或试试：' : '问我关于微信数据的任何问题。'} className="gap-1.5 px-0 py-0 [&>div:first-child]:bg-accent-15 [&>div:first-child]:text-accent" />
      <Suggestions items={suggestions.slice(0, 3)} onPick={onPick} className="max-w-[280px]" />
    </div>
  )
}
