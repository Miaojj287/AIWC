/**
 * 回复台 Tab (kind 'replydesk'): halted banner (自动发送已熔断 + 恢复), then the draft cards oldest first.
 * Live-updated through the reply-desk store; countdowns tick locally between gateway events.
 */
import { AutoReplyControl } from '@/features/autoreply/AutoReplyControl'
import { Inbox, OctagonAlert, Play, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { Button, EmptyState, ICON_STROKE, ScrollArea, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { DraftCard } from './DraftCard'
import { pendingCount, remainingMs } from './reducer'
import { startReplyDesk, useReplyDeskStore } from './store'

export function ReplyDeskTab(_props: TabRendererProps) {
  const t = useT()
  const state = useReplyDeskStore((s) => s.state)
  const dispatch = useReplyDeskStore((s) => s.dispatch)
  const reload = useReplyDeskStore((s) => s.reload)
  const countdownMs = useConfig((c) => c.autoReply.countdownMs) ?? 5000
  const [now, setNow] = useState(() => Date.now())
  const [resuming, setResuming] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void startReplyDesk()
  }, [])

  const hasAuto = state.drafts.some((d) => d.mode === 'auto' && d.state === 'pending')
  useEffect(() => {
    if (!hasAuto) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [hasAuto])

  const resume = async () => {
    setResuming(true)
    try {
      await invoke('autoreply:resume', undefined)
      dispatch({ type: 'resumed' })
    } catch (e) {
      toast.error(t('replydesk.tab.resumeFailed'), { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setResuming(false)
    }
  }

  const pending = pendingCount(state)
  // Only one primary button per view (CLAUDE.md §3): the oldest pending draft owns 发送.
  const primaryDraftId = state.drafts.find((d) => d.state === 'pending')?.id

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
        <div className="flex size-9 items-center justify-center rounded-item bg-accent-15 text-accent">
          <Inbox size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-bubble font-medium leading-5 text-fg">{t('replydesk.tab.title')}</span>
          <span className="truncate text-caption text-fg-3">
            {pending > 0 ? t('replydesk.tab.pendingSubtitle', { n: pending }) : t('replydesk.tab.idleSubtitle')}
          </span>
        </div>
        <Button
          variant="ghost"
          icon={RefreshCw}
          loading={refreshing}
          onClick={() => {
            if (refreshing) return
            setRefreshing(true)
            void reload().finally(() => setRefreshing(false))
          }}
        >
          {t('common.refresh')}
        </Button>
      </header>
      {state.halted ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2.5 border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-caption text-danger"
        >
          <OctagonAlert size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={t('replydesk.tab.halted', { reason: state.halted })}>
            {t('replydesk.tab.halted', { reason: state.halted })}
          </span>
          <Button
            variant="outline"
            size="sm"
            icon={Play}
            loading={resuming}
            onClick={() => void resume()}
            className="border-danger/40 text-danger hover:bg-danger/10"
          >
            {t('replydesk.tab.resume')}
          </Button>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-5 py-4">
          <AutoReplyControl />
          {Object.entries(state.generating ?? {}).map(([id, name]) => (
            <div key={id} role="status" className="rounded-card border border-line-6 p-4 text-caption text-fg-2">
              {t('replydesk.tab.generating', { name })}
            </div>
          ))}
          {!state.loaded ? (
            <EmptyState variant="loading" title={t('replydesk.tab.loading')} />
          ) : state.error && state.drafts.length === 0 ? (
            <EmptyState
              variant="error"
              title={t('replydesk.tab.loadFailed')}
              description={state.error}
              action={{ label: t('common.retry'), onClick: () => void reload() }}
            />
          ) : state.drafts.length === 0 && !Object.keys(state.generating ?? {}).length ? (
            <EmptyState
              variant="empty"
              icon={Inbox}
              title={t('replydesk.tab.emptyTitle')}
              description={t('replydesk.tab.emptyDescription')}
            />
          ) : (
            state.drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                primary={d.id === primaryDraftId}
                remainingMs={remainingMs(state, d, now)}
                countdownTotalMs={countdownMs}
                onDismiss={(id) => dispatch({ type: 'dismiss', draftId: id })}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
