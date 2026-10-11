/**
 * Search hits grouped by chat, in one virtual list (results may run to MAX_RESULTS rows; AGENTS.md §3.7): a chat row
 * (avatar 36 · name · match count) then its hits (sender · time · snippet with the matched words marked). A hit opens
 * the chat scrolled to that message; `···` / right-click add 只搜这个聊天, 复制文字 and 引用到 Agent. The foot is
 * 加载更多, the cap notice, or a failed 加载更多 with 重试. The line above the list counts the hits.
 */
import { AtSign, Copy, ListFilter, MessageSquare } from 'lucide-react'
import { useMemo } from 'react'
import { VList } from 'virtua'
import type { SearchHit, WxSession } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { Avatar, Button, HelpTip, InlineHint, Skeleton, Spinner, toast, type MenuSpec } from '@/kit'
import { formatDateTime, formatTime } from '@/platform/format'
import { listKeyNav } from '@/platform/listNavigation'
import { toMediaUrl } from '@/platform/mediaUrl'
import { MenuRow } from './MenuRow'
import { MAX_RESULTS, resultRows, senderLabel, type HitGroup, type ResultRow } from './searchModel'
import { copyTextOf, parseSnippet, type SnippetPart } from './snippetModel'
import type { HistorySearch } from './useHistorySearch'

export interface SearchResultsProps {
  query: string
  groups: readonly HitGroup[]
  search: HistorySearch
  /** `undefined` while the chat is being looked up, `null` when it is unknown. */
  chat(id: string): WxSession | null | undefined
  onOpenHit(hit: SearchHit): void
  onOnlyChat(sessionId: string): void
}

export function SearchResults({ query, groups, search, chat, onOpenHit, onOnlyChat }: SearchResultsProps) {
  const t = useT()
  const withEnd = search.hasMore || search.loadingMore || search.capped || search.error !== undefined
  const rows = useMemo(() => resultRows(groups, withEnd), [groups, withEnd])
  const count = search.hits.length
  const summary =
    search.hasMore || search.loadingMore
      ? t('search.summary.top', { n: count, chats: groups.length })
      : t('search.summary.results', { n: count, chats: groups.length })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[880px] shrink-0 items-center gap-1.5 px-5 pb-1 pt-3 text-caption leading-4 text-fg-3">
        {search.pending && !search.loadingMore ? <Spinner size={12} /> : null}
        <span role="status" className="min-w-0 truncate">
          {search.pending && !search.loadingMore ? t('search.summary.searching') : summary}
        </span>
        <HelpTip content={t('search.summary.order')} subject={t('search.results.label')} />
      </div>
      <div className="min-h-0 flex-1" onKeyDown={listKeyNav}>
        <VList data={rows} className="h-full pb-4" style={{ height: '100%' }} aria-label={t('search.results.label')}>
          {(row: ResultRow) => (
            <div key={row.key} className="mx-auto w-full max-w-[880px] px-3">
              {row.kind === 'group' ? (
                <GroupRow
                  sessionId={row.sessionId}
                  count={row.count}
                  first={row.first}
                  session={chat(row.sessionId)}
                  onOnlyChat={onOnlyChat}
                />
              ) : row.kind === 'hit' ? (
                <HitRow
                  hit={row.hit}
                  query={query}
                  session={chat(row.hit.message.sessionId)}
                  onOpen={onOpenHit}
                  onOnlyChat={onOnlyChat}
                />
              ) : (
                <EndRow search={search} />
              )}
            </div>
          )}
        </VList>
      </div>
    </div>
  )
}

function quoteToAgent(sessionId: string, label: string, messageIds?: string[]): void {
  runCommand('agent.quote', { kind: 'session', id: sessionId, label, messageIds })
}

interface GroupRowProps {
  sessionId: string
  count: number
  first: boolean
  session: WxSession | null | undefined
  onOnlyChat(sessionId: string): void
}

function GroupRow({ sessionId, count, first, session, onOnlyChat }: GroupRowProps) {
  const t = useT()
  const name = session === undefined ? '' : session?.title || t('search.group.unknown')
  const open = () => runCommand('tab.openChat', { sessionId, title: session?.title ?? '' })
  const menu: MenuSpec = [
    { id: 'open', label: t('search.menu.openChat'), icon: MessageSquare, onSelect: open },
    { id: 'only', label: t('search.menu.onlyThisChat'), icon: ListFilter, onSelect: () => onOnlyChat(sessionId) },
    { type: 'separator' },
    {
      id: 'quote',
      label: t('search.menu.quote'),
      icon: AtSign,
      onSelect: () => {
        quoteToAgent(sessionId, name)
        toast.success(t('search.toast.quoted'))
      },
    },
  ]
  return (
    <div className={first ? 'pt-1' : 'pt-4'}>
      <MenuRow
        leading={<Avatar id={sessionId} name={name} size={36} src={toMediaUrl(session?.avatarPath)} />}
        title={name || <Skeleton className="h-3 w-28" />}
        subtitle={t('search.group.hits', { n: count })}
        onSelect={open}
        menu={menu}
        moreLabel={t('search.group.moreActions', { name })}
      />
    </div>
  )
}

interface HitRowProps {
  hit: SearchHit
  query: string
  session: WxSession | null | undefined
  onOpen(hit: SearchHit): void
  onOnlyChat(sessionId: string): void
}

function HitRow({ hit, query, session, onOpen, onOnlyChat }: HitRowProps) {
  const t = useT()
  const message = hit.message
  const chatTitle = session?.title ?? ''
  const parts = useMemo(
    () => parseSnippet(hit.snippet.trim() ? hit.snippet : message.text, query),
    [hit.snippet, message.text, query],
  )
  const sender = senderLabel(message, { me: t('common.me'), direct: session?.kind === 'dm', chatTitle })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyTextOf(hit, query))
      toast.success(t('common.copied', { what: t('search.toast.messageText') }))
    } catch {
      toast.error(t('common.copyFailed'))
    }
  }
  const menu: MenuSpec = [
    { id: 'open', label: t('search.menu.openInChat'), icon: MessageSquare, onSelect: () => onOpen(hit) },
    {
      id: 'only',
      label: t('search.menu.onlyThisChat'),
      icon: ListFilter,
      onSelect: () => onOnlyChat(message.sessionId),
    },
    { id: 'copy', label: t('search.menu.copyText'), icon: Copy, onSelect: () => void copy() },
    { type: 'separator' },
    {
      id: 'quote',
      label: t('search.menu.quote'),
      icon: AtSign,
      onSelect: () => {
        quoteToAgent(message.sessionId, chatTitle || t('search.group.unknown'), [message.id])
        toast.success(t('search.toast.quoted'))
      },
    },
  ]
  return (
    <MenuRow
      dense
      // An empty avatar column: hits line up under their chat's name.
      leading={<span aria-hidden />}
      title={sender}
      meta={
        Number.isFinite(message.createdAt) ? (
          <time dateTime={new Date(message.createdAt).toISOString()} title={formatDateTime(message.createdAt)}>
            {formatTime(message.createdAt)}
          </time>
        ) : undefined
      }
      subtitle={<Snippet parts={parts} />}
      tooltip={parts.map((part) => part.text).join('')}
      onSelect={() => onOpen(hit)}
      menu={menu}
      moreLabel={t('search.hit.moreActions')}
    />
  )
}

/** One inline span (ListItem spaces its subtitle's element children apart); matches as marks, never HTML. */
function Snippet({ parts }: { parts: readonly SnippetPart[] }) {
  return (
    <span>
      {parts.map((part, i) =>
        part.mark ? (
          <mark key={i} className="rounded-sm bg-accent-30 px-px text-fg">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
}

function EndRow({ search }: { search: HistorySearch }) {
  const t = useT()
  if (search.error) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 py-4">
        <InlineHint kind="error" live={false}>
          {t('search.results.moreFailed')}
        </InlineHint>
        <Button variant="outline" size="sm" onClick={search.rerun}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (search.capped) {
    return (
      <p className="px-3 py-4 text-center text-caption leading-4 text-fg-3">
        {t('search.summary.capped', { n: MAX_RESULTS })}
      </p>
    )
  }
  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" size="sm" loading={search.loadingMore} onClick={search.loadMore}>
        {t('search.results.loadMore')}
      </Button>
    </div>
  )
}
