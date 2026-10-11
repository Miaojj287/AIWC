/**
 * 已归档 at the foot of the Agent window's thread list: a disclosure that loads the archived threads on first open.
 * Rows open the thread like any other row; their menu (threadMenus, shared with the panel's history popover) offers
 * 取消归档 in place of 归档.
 */
import { Archive, ChevronRight, Ellipsis } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { ThreadSummary } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  ICON_STROKE,
  IconButton,
  ListItem,
} from '@/kit'
import { formatTime } from '@/platform/format'
import { useAgentStore } from '../agentStore'
import { isUntitledTitle } from '../model'
import { threadRowMenu } from '../threadMenus'
import type { AgentSurface } from '../useAgentSurface'
import { filterThreads } from './threadGroups'

export function SidebarArchived({ surface, query }: { surface: AgentSurface; query: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const listId = useId()
  const loading = useAgentStore((s) => s.archivedLoading)
  const untitled = t('agent.thread.untitled')
  const rows = useMemo(() => filterThreads(surface.archived, query, untitled), [surface.archived, query, untitled])
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void surface.store().loadArchived()
  }
  return (
    <section className="flex flex-col gap-px pb-1.5" data-group="archived">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        className="flex min-w-0 items-center gap-1 rounded-control px-2.5 pb-1 pt-2 text-left text-micro font-medium text-fg-3 outline-none hover:text-fg-2"
      >
        <ChevronRight
          size={12}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 truncate">{t('agent.stream.archive.section')}</span>
        {surface.archivedLoaded ? <span className="shrink-0 tabular-nums">{surface.archived.length}</span> : null}
      </button>
      {open ? (
        <div id={listId} className="flex flex-col gap-px">
          {rows.length === 0 ? (
            <EmptyState
              compact
              variant={loading ? 'loading' : query ? 'no-results' : 'empty'}
              title={
                loading
                  ? t('agent.stream.archive.loading')
                  : query
                    ? t('agent.window.sidebar.noResults')
                    : t('agent.stream.archive.empty')
              }
              className="py-3"
            />
          ) : (
            rows.map((thread) => <ArchivedRow key={thread.threadId} thread={thread} surface={surface} />)
          )}
        </div>
      ) : null}
    </section>
  )
}

function ArchivedRow({ thread, surface }: { thread: ThreadSummary; surface: AgentSurface }) {
  const t = useT()
  const { store, onAction, activeThreadId } = surface
  const id = thread.threadId
  const title = isUntitledTitle(thread.title) ? t('agent.thread.untitled') : thread.title
  const menu = useMemo(
    () =>
      threadRowMenu(t, {
        thread,
        saved: true,
        onOpen: () => store().setActive(id),
        onAction,
        onPin: (threadId, pinned) => void store().pin(threadId, pinned),
      }),
    [id, onAction, store, t, thread],
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          dense
          selected={id === activeThreadId}
          onSelect={() => store().setActive(id)}
          leading={<Archive size={15} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />}
          title={title}
          subtitle={thread.contextRef?.label ?? t('agent.history.noContext')}
          meta={formatTime(thread.updatedAt)}
          hoverActions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Ellipsis} label={t('agent.window.sidebar.moreActions', { title })} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItems items={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          }
          data-thread-id={id}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
