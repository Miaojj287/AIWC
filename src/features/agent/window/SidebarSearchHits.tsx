/**
 * The Agent window sidebar's part of a thread search (threadSearch.ts, shared with the panel's history popover):
 * conversations whose messages contain the words, below the title matches, and 加载更多 under the full history.
 */
import { History, TextSearch } from 'lucide-react'
import type { ThreadSearchHit } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, ICON_STROKE, ListItem } from '@/kit'
import { formatTime } from '@/platform/format'
import { useAgentStore } from '../agentStore'
import { isUntitledTitle } from '../model'
import { SnippetText } from '../SnippetText'

export function SidebarContentHits({ hits, loading }: { hits: readonly ThreadSearchHit[]; loading: boolean }) {
  const t = useT()
  if (hits.length === 0 && !loading) return null
  return (
    <section
      className="flex flex-col gap-px pb-1.5"
      data-group="content"
      aria-label={t('agent.history.contentMatches')}
    >
      <h2 className="m-0 px-2.5 pb-1 pt-2 text-micro font-medium text-fg-3">{t('agent.history.contentMatches')}</h2>
      {hits.length === 0 ? (
        <p className="m-0 px-2.5 py-1 text-micro text-fg-3">{t('agent.history.searching')}</p>
      ) : (
        hits.map((hit) => (
          <ListItem
            key={hit.threadId}
            dense
            onSelect={() => useAgentStore.getState().revealItem(hit.threadId, hit.itemId)}
            leading={<TextSearch size={15} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />}
            title={isUntitledTitle(hit.title) ? t('agent.thread.untitled') : hit.title}
            subtitle={<SnippetText snippet={hit.snippet} />}
            meta={formatTime(hit.ts)}
            data-thread-id={hit.threadId}
          />
        ))
      )}
    </section>
  )
}

/** Older threads beyond the loaded pages. */
export function SidebarLoadMore() {
  const t = useT()
  const hasMore = useAgentStore((s) => s.hasMoreThreads)
  const loading = useAgentStore((s) => s.loadingMoreThreads)
  if (!hasMore) return null
  return (
    <div className="flex justify-center px-2 py-2">
      <Button
        size="sm"
        variant="ghost"
        icon={History}
        loading={loading}
        onClick={() => void useAgentStore.getState().loadMoreThreads()}
      >
        {t('agent.history.loadMore')}
      </Button>
    </div>
  )
}
