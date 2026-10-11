/**
 * 每日待办 dashboard (Tab kind 'todo', single instance objectId 'todo'). Header: title (the chat's name
 * when narrowed to one), schedule / last / next scan, 立即扫描 and 扫描设置. Body: where the data goes,
 * any notice (off / no chats / chat not scanned / last scan failed), then the checklist and the day's
 * chat summaries — side by side when the tab is wide, stacked when narrow (the Agent window's pane).
 *
 * `tab.state.sourceId` narrows everything to one scanned chat (set by the object list). 立即扫描 is a
 * long task: a progress dialog with steps and 取消; scheduled scans only show in the status line.
 */
import { ListFilter, ListTodo, Plus, RefreshCw, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TodoProgress } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  InlineHint,
  ProgressDialog,
  ScrollArea,
  Spinner,
  Tooltip,
  toast,
  type ProgressStep,
} from '@/kit'
import { useConfig, useConfigStore } from '@/platform/configStore'
import { formatClock } from '@/platform/format'
import { useInvoke } from '@/platform/hooks'
import { modelDestination } from '@/platform/modelDestination'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { TodoChecklist } from './TodoChecklist'
import { TodoSummaries } from './TodoSummaries'
import { failureText, scanTime, statusLine, visibleItems } from './todoModel'
import { setSourcePicked } from './todoSources'
import { cancelTodoScan, scanTodos, useTodos, useTodoStore } from './todoStore'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const openSettings = () => runCommand('tab.openSettings', { page: 'todo' })

export function TodoTab({ tab }: TabRendererProps) {
  const t = useT()
  const config = useConfig((c) => c.todo)
  const ai = useConfig((c) => c.ai)
  const defaultModel = ai?.defaultModel
  const { items, status, loaded, error, progress } = useTodos()
  // Refetched when 设置 › AI 接入 changes, so the data-destination note never names a stale model.
  const models = useInvoke('agent:listModels', undefined, [ai])
  const sourceId = typeof tab.state?.sourceId === 'string' ? tab.state.sourceId : undefined
  const session = useInvoke('substrate:getSession', { id: sourceId ?? '' }, [sourceId], { enabled: Boolean(sourceId) })
  const source = config?.sources.find((s) => s.id === sourceId)
  const sourceTitle = session.data?.title || source?.title || sourceId || ''
  const { open, done } = useMemo(() => visibleItems(items, sourceId), [items, sourceId])
  /** A scan this window started: the progress dialog follows it (scheduled scans stay in the header). */
  const [manualScan, setManualScan] = useState(false)
  const running = status?.running === true || manualScan
  const refreshKey = status?.last?.finishedAt ?? 0

  const enabled = config?.enabled === true
  const sources = config?.sources ?? []
  const destination = modelDestination(models.data ?? [], config?.model, defaultModel)
  const scanBlocked = !enabled
    ? t('todo.scan.blockedOff')
    : sources.length === 0
      ? t('todo.scan.blockedNoSources')
      : sourceId && !source
        ? t('todo.scan.blockedNotPicked')
        : destination.kind === 'none'
          ? t('todo.scan.blockedNoModel')
          : running
            ? t('todo.scan.blockedRunning')
            : undefined

  const scan = async () => {
    setManualScan(true)
    try {
      await scanTodos(sourceId ? [sourceId] : undefined)
    } finally {
      setManualScan(false)
    }
  }
  const turnOn = async () => {
    try {
      await useConfigStore.getState().set({ todo: { enabled: true } })
      toast.success(t('todo.toast.turnedOn'))
    } catch (e) {
      toast.error(t('todo.toast.turnOnFailed'), { detail: errorText(e) })
    }
  }

  const title = sourceId ? sourceTitle : t('todo.tab.title')
  const subtitle = statusLine(config, status, t, (ms) => scanTime(ms, t, formatClock))
  const nothingYet = loaded && items.length === 0

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-content">
      <header className="flex min-h-18 shrink-0 items-center gap-3 border-b border-line-6 px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="min-w-0 truncate text-bubble font-semibold leading-5 text-fg" title={title}>
            {title}
          </h1>
          <div className="flex min-w-0 items-center gap-1.5 text-caption leading-4 text-fg-3">
            {status?.running ? <Spinner size={12} /> : null}
            <span className="min-w-0 truncate" title={subtitle}>
              {subtitle}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          icon={RefreshCw}
          disabled={scanBlocked !== undefined}
          disabledReason={scanBlocked}
          onClick={() => void scan()}
        >
          {sourceId ? t('todo.scan.nowOne') : t('todo.scan.now')}
        </Button>
        <Tooltip content={t('todo.header.settings')}>
          <IconButton icon={Settings} label={t('todo.header.settings')} onClick={openSettings} />
        </Tooltip>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5 px-8 py-6 @max-[640px]:px-4">
          {sourceId ? (
            <div className="flex min-w-0 items-center gap-2">
              <Chip
                variant="mention"
                icon={ListFilter}
                label={t('todo.filter.only', { name: sourceTitle })}
                onRemove={() => runCommand('tab.openTodo', {})}
                className="max-w-full"
              />
            </div>
          ) : null}

          <Notices
            enabled={enabled}
            hasItems={!nothingYet}
            sourceCount={sources.length}
            unpicked={sourceId && !source ? { id: sourceId, title: sourceTitle } : undefined}
            onTurnOn={() => void turnOn()}
            onRetry={() => void scan()}
            canRetry={scanBlocked === undefined}
          />

          {error && !loaded ? (
            <EmptyState
              variant="error"
              title={t('todo.list.loadFailedTitle')}
              description={error.message}
              action={{ label: t('common.retry'), onClick: () => void useTodoStore.getState().load() }}
            />
          ) : !loaded ? (
            <EmptyState variant="loading" title={t('todo.list.loading')} />
          ) : config && !enabled && nothingYet ? (
            <EmptyState
              icon={ListTodo}
              title={t('todo.empty.offTitle')}
              description={t('todo.empty.offDescription')}
              action={{ label: t('todo.empty.turnOn'), onClick: () => void turnOn() }}
              secondaryAction={{ label: t('todo.header.settings'), icon: Settings, onClick: openSettings }}
            />
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 @min-[880px]:grid-cols-2">
              <TodoChecklist open={open} done={done} showSource={!sourceId} canAdd={!sourceId} />
              <TodoSummaries sourceId={sourceId} refreshKey={refreshKey} />
            </div>
          )}
        </div>
      </ScrollArea>

      <ScanDialog open={manualScan} progress={progress} onCancel={() => void cancelTodoScan()} />
    </div>
  )
}

interface NoticesProps {
  enabled: boolean
  hasItems: boolean
  sourceCount: number
  unpicked?: { id: string; title: string }
  onTurnOn(): void
  onRetry(): void
  canRetry: boolean
}

/** At most one line of "why nothing is happening", most blocking first, each with the one action that fixes it. */
function Notices({ enabled, hasItems, sourceCount, unpicked, onTurnOn, onRetry, canRetry }: NoticesProps) {
  const t = useT()
  const last = useTodoStore((s) => s.status?.last)
  if (!enabled)
    return hasItems ? (
      <Notice kind="info" text={t('todo.notice.off')} action={{ label: t('todo.empty.turnOn'), onClick: onTurnOn }} />
    ) : null
  if (unpicked)
    return (
      <Notice
        kind="info"
        text={t('todo.notice.notPicked', { name: unpicked.title })}
        action={{
          label: t('todo.notice.pick'),
          icon: Plus,
          onClick: () => void setSourcePicked(unpicked, true),
        }}
      />
    )
  if (sourceCount === 0) return <Notice kind="info" text={t('todo.notice.noSources')} />
  if (last && !last.ok && last.failure && last.failure !== 'cancelled' && last.failure !== 'busy') {
    const params = { time: scanTime(last.startedAt, t, formatClock), reason: failureText(last.failure, t) }
    return (
      <Notice
        kind="error"
        text={
          last.detail
            ? t('todo.notice.lastFailedDetail', { ...params, detail: last.detail })
            : t('todo.notice.lastFailed', params)
        }
        action={
          last.failure === 'model_unavailable'
            ? { label: t('todo.notice.setUpModel'), onClick: () => runCommand('tab.openSettings', { page: 'ai' }) }
            : canRetry
              ? { label: t('common.retry'), onClick: onRetry }
              : undefined
        }
      />
    )
  }
  return null
}

function Notice({
  kind,
  text,
  action,
}: {
  kind: 'info' | 'error'
  text: string
  action?: { label: string; onClick: () => void; icon?: typeof Plus }
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line-6 bg-panel px-4 py-3">
      <InlineHint kind={kind} live={false} className="min-w-0 flex-1">
        {text}
      </InlineHint>
      {action ? (
        <Button variant="outline" size="sm" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

function ScanDialog({
  open,
  progress,
  onCancel,
}: {
  open: boolean
  progress: TodoProgress | undefined
  onCancel: () => void
}) {
  const t = useT()
  const step = progress?.step ?? 'collect'
  const order = ['collect', 'summarize', 'save'] as const
  const at = order.indexOf(step)
  const statusOf = (i: number): ProgressStep['status'] => (i < at ? 'done' : i === at ? 'doing' : 'todo')
  const total = progress?.total ?? 0
  const finished = step === 'summarize' ? (progress?.done ?? 0) : step === 'save' ? total : 0
  const steps: ProgressStep[] = [
    { id: 'collect', label: t('todo.scan.steps.collect'), status: statusOf(0) },
    {
      id: 'summarize',
      label: t('todo.scan.steps.summarize', { done: finished, total }),
      status: statusOf(1),
      ...(step === 'summarize' && progress?.source ? { detail: progress.source } : {}),
    },
    { id: 'save', label: t('todo.scan.steps.save'), status: statusOf(2) },
  ]
  const value = step === 'collect' ? 5 : step === 'save' ? 95 : 10 + Math.round((80 * finished) / Math.max(1, total))
  return (
    <ProgressDialog
      open={open}
      icon={RefreshCw}
      title={t('todo.scan.dialogTitle')}
      description={t('todo.scan.dialogDescription')}
      value={value}
      steps={steps}
      onCancel={onCancel}
    />
  )
}
