/**
 * Context ring — 18px SVG ring in the composer toolbar showing used / max tokens; hover opens the
 * breakdown popover with a 压缩上下文 button (DESIGN-SPEC §1.3 上下文计量, Figma 150:856).
 */
import { Layers } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ContextUsage } from '@aiwc/protocol'
import { Button, cn, Popover, PopoverContent, PopoverTrigger, ProgressBar } from '@/kit'
import { formatTokens, usageRatio, USAGE_WARN_RATIO } from '../model'

export interface ContextRingProps {
  usage?: ContextUsage
  onCompact?: () => void
  disabled?: boolean
  size?: number
}

const R = 7
const CIRC = 2 * Math.PI * R

export function ContextRing({ usage, onCompact, disabled = false, size = 18 }: ContextRingProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ratio = usageRatio(usage)
  const pct = Math.round(ratio * 100)
  const tone = ratio >= 0.95 ? 'text-danger' : ratio >= USAGE_WARN_RATIO ? 'text-warn' : 'text-accent'

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 160)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={usage ? `上下文占用 ${pct}%` : '上下文占用'}
          disabled={disabled}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-control outline-none transition-colors hover:bg-line-8 focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40', tone)}
        >
          <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className="-rotate-90">
            <circle cx="9" cy="9" r={R} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2} />
            <circle cx="9" cy="9" r={R} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ratio)} className="transition-[stroke-dashoffset] duration-(--dur-base)" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[240px]" onMouseEnter={show} onMouseLeave={hide} onOpenAutoFocus={(e) => e.preventDefault()}>
        {usage ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-body font-medium text-fg">上下文占用</span>
              <span className={cn('font-latin text-body font-medium', tone)}>{pct}%</span>
            </div>
            <ProgressBar value={pct} label="上下文占用" className={cn(ratio >= USAGE_WARN_RATIO && '[&>div]:bg-warn', ratio >= 0.95 && '[&>div]:bg-danger')} />
            <div className="font-latin text-caption text-fg-3">
              {formatTokens(usage.usedTokens)} / {formatTokens(usage.maxTokens)} tokens
            </div>
            <dl className="m-0 flex flex-col gap-1 text-caption">
              <Row label="系统提示 + 记忆" value={usage.breakdown.system + usage.breakdown.memory} />
              <Row label="引用的会话消息" value={usage.breakdown.references} />
              <Row label="对话历史" value={usage.breakdown.history} />
              {usage.breakdown.tools > 0 ? <Row label="工具定义" value={usage.breakdown.tools} /> : null}
            </dl>
            {onCompact ? (
              <Button variant="ghost" icon={Layers} onClick={onCompact} className="w-full">
                压缩上下文
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-fg">上下文占用</span>
            <span className="text-caption text-fg-3">发送第一条消息后开始统计。</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-2">{label}</dt>
      <dd className="m-0 font-latin text-fg-3">{formatTokens(value)}</dd>
    </div>
  )
}
