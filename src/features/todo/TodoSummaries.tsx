/**
 * 每日摘要: what each scanned chat talked about on one day, with ‹ › to step through the days that
 * have summaries. A card per chat (title → the chat, message count and window, the summary). Narrowed
 * to one chat when the dashboard is.
 */
import { ChevronLeft, ChevronRight, MessageSquare, NotebookText } from 'lucide-react'
import { useState } from 'react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { EmptyState, IconButton, SkeletonListRows } from '@/kit'
import { formatClock } from '@/platform/format'
import { useInvoke } from '@/platform/hooks'
import { adjacentDays, dayLabel, summaryWindow } from './todoModel'

export interface TodoSummariesProps {
  sourceId?: string
  /** Bumped when a scan finished, so the shown day reloads. */
  refreshKey: number
}

export function TodoSummaries({ sourceId, refreshKey }: TodoSummariesProps) {
  const t = useT()
  const days = useInvoke('todo:days', undefined, [refreshKey])
  /** The day the user stepped to with ‹ ›; unset (or gone) = the newest day. */
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const date = picked && days.data?.includes(picked) ? picked : days.data?.[0]
  const day = useInvoke('todo:day', { date: date ?? '' }, [date, refreshKey], { enabled: Boolean(date) })
  const { older, newer } = adjacentDays(days.data ?? [], date)
  const chats = (day.data?.chats ?? []).filter((c) => !sourceId || c.sourceId === sourceId)

  return (
    <section className="flex flex-col gap-3" aria-labelledby="todo-summary-heading">
      <div className="flex items-center gap-1 px-1">
        <h2 id="todo-summary-heading" className="min-w-0 truncate text-body font-semibold text-fg">
          {date ? t('todo.summary.heading', { day: dayLabel(date, t) }) : t('todo.summary.headingEmpty')}
        </h2>
        <span className="flex-1" />
        <IconButton
          size="sm"
          icon={ChevronLeft}
          label={t('todo.summary.older')}
          disabled={!older}
          onClick={() => older && setPicked(older)}
        />
        <IconButton
          size="sm"
          icon={ChevronRight}
          label={t('todo.summary.newer')}
          disabled={!newer}
          onClick={() => newer && setPicked(newer)}
        />
      </div>
      {days.loading && !days.data ? (
        <SkeletonListRows rows={3} avatar={false} />
      ) : days.error ? (
        <EmptyState
          compact
          variant="error"
          title={t('todo.summary.loadFailed')}
          description={days.error.message}
          action={{ label: t('common.retry'), onClick: days.reload }}
        />
      ) : day.error ? (
        <EmptyState
          compact
          variant="error"
          title={t('todo.summary.loadFailed')}
          description={day.error.message}
          action={{ label: t('common.retry'), onClick: day.reload }}
        />
      ) : chats.length === 0 ? (
        <EmptyState
          compact
          icon={NotebookText}
          title={t('todo.summary.emptyTitle')}
          description={t('todo.summary.emptyDescription')}
          bordered
        />
      ) : (
        <div className="flex flex-col gap-2">
          {chats.map((chat) => (
            <article
              key={chat.sourceId}
              className="flex flex-col gap-1.5 rounded-card border border-line-6 bg-panel px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="min-w-0 truncate text-body font-medium text-fg" title={chat.title}>
                  {chat.title}
                </h3>
                <span className="shrink-0 text-caption text-fg-3">
                  {t('todo.summary.meta', {
                    n: chat.messageCount,
                    window: summaryWindow(chat.from, chat.to, formatClock, t),
                  })}
                </span>
                <span className="flex-1" />
                <IconButton
                  size="sm"
                  icon={MessageSquare}
                  label={t('todo.summary.openChat', { name: chat.title })}
                  onClick={() => runCommand('tab.openChat', { sessionId: chat.sourceId, title: chat.title })}
                />
              </div>
              <p className="whitespace-pre-wrap break-words text-body leading-5 text-fg-2">{chat.summary}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
