/**
 * 克隆中 progress card (Figma 156:1528): avatar, 已用 / 预计, ProgressBar, ✓/⟳/○ step list, 取消克隆.
 * The tab can be left; progress also shows on the contact list's second line.
 */
import { Check, Circle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CloneStatus } from '@aiwc/protocol'
import { Avatar, Button, Card, ICON_STROKE, ProgressBar, Spinner, cn } from '@/kit'
import { buildSteps, formatElapsed, formatEta, progressPercent } from '../cloneView'
import { CancelCloneDialog } from './CloneDialogs'

export interface BuildingViewProps {
  contactId: string
  name: string
  avatarPath?: string
  status: Extract<CloneStatus, { state: 'building' }>
  onCancel: () => Promise<void>
}

export function BuildingView({ contactId, name, avatarPath, status, onCancel }: BuildingViewProps) {
  const [now, setNow] = useState(() => Date.now())
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const percent = progressPercent(status.progress)
  const eta = formatEta(status.progress.etaMs)
  const steps = buildSteps(status.progress)

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-8 py-10">
      <Card className="flex w-full max-w-[440px] flex-col items-center gap-4 p-6 text-center">
        <Avatar id={contactId} name={name} src={avatarPath} size={56} className="ring-4 ring-clone/25" />
        <div className="flex flex-col gap-1">
          <h1 className="text-bubble font-medium leading-6 text-fg">正在克隆「{name}」</h1>
          <p className="font-latin text-caption text-fg-3">
            已用 {formatElapsed(Math.max(0, now - status.progress.startedAt))}
            {eta ? ` · 预计还需 ${eta.replace(/^约 /, '')}` : ''}
          </p>
        </div>
        <ProgressBar value={percent} label="克隆进度" />
        <ol className="flex w-full flex-col gap-2 text-left">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-tab">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {s.status === 'done' ? <Check size={13} strokeWidth={2} aria-hidden className="text-ok" /> : s.status === 'doing' ? <Spinner size={13} /> : <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', s.status === 'todo' ? 'text-fg-3' : 'text-fg')}>{s.label}</span>
              {s.status === 'doing' ? <span className="font-latin text-micro tabular-nums text-fg-3">{percent}%</span> : null}
            </li>
          ))}
        </ol>
        <Button variant="ghost" icon={X} onClick={() => setConfirm(true)}>
          取消克隆
        </Button>
      </Card>
      <CancelCloneDialog
        open={confirm}
        onOpenChange={setConfirm}
        percent={percent}
        onConfirm={() => {
          setConfirm(false)
          void onCancel()
        }}
      />
    </div>
  )
}
