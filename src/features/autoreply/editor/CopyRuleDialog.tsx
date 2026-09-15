/**
 * 复制规则到其他会话 (board 152:415 ②): search + checkbox list of sessions (已有规则 badge), then
 * saveRule(copyRuleTo(rule, sessionId)) for each. Uses the shared FormDialog. The chats are paged and
 * searched on the backend, so every chat can be picked however long the chat list is.
 */
import { Copy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtualizer } from 'virtua'
import type { AutoReplyRule } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Avatar, Badge, Checkbox, EmptyState, FormDialog, SearchBox, SkeletonListRows, toast } from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import { isRuleTarget } from '../ruleListModel'
import { copyRuleTo } from '../ruleModel'
import { usePagedSessions } from '../sessionPaging'

/** Fetch the next page once the list is scrolled this close to its end. */
const LOAD_MORE_THRESHOLD_PX = 120
/** Keep paging without a scroll while fewer candidates than this are loaded (the list must be able to scroll). */
const MIN_FILLED_ROWS = 16

export interface CopyRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: AutoReplyRule
  sourceTitle: string
  onCopied?: (sessionIds: string[]) => void
}

export function CopyRuleDialog({ open, onOpenChange, rule, sourceTitle, onCopied }: CopyRuleDialogProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const sessions = usePagedSessions(query, open)
  const { hasMore, loadMore } = sessions
  const rules = useInvoke('autoreply:listRules', undefined, [open], { enabled: open })
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const withRule = useMemo(() => new Set((rules.data ?? []).map((r) => r.sessionId)), [rules.data])
  const candidates = useMemo(
    () => sessions.items.filter((s) => s.id !== rule.sessionId && isRuleTarget(s)),
    [sessions.items, rule.sessionId],
  )

  const loadMoreNearEnd = useCallback(() => {
    const el = scrollRef.current
    if (hasMore && el && el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD_PX) loadMore()
  }, [hasMore, loadMore])
  useEffect(() => {
    if (open && hasMore && candidates.length < MIN_FILLED_ROWS) loadMore()
  }, [open, hasMore, candidates.length, loadMore])

  const toggle = (id: string, on: boolean) =>
    setPicked((set) => {
      const next = new Set(set)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const submit = async () => {
    const ids = [...picked]
    setBusy(true)
    try {
      await Promise.all(ids.map((sid) => invoke('autoreply:saveRule', copyRuleTo(rule, sid))))
      toast.success(t('autoreply.copyDialog.copied', { n: ids.length }))
      onCopied?.(ids)
      onOpenChange(false)
      setPicked(new Set())
    } catch (e) {
      toast.error(t('autoreply.copyDialog.failed'), { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const listBody =
    sessions.loading || (candidates.length === 0 && (hasMore || sessions.loadingMore) && !sessions.error) ? (
      <SkeletonListRows rows={4} className="p-2" />
    ) : sessions.error && candidates.length === 0 ? (
      <EmptyState
        compact
        variant="error"
        title={t('autoreply.list.loadFailed')}
        description={sessions.error.message}
        action={{ label: t('common.retry'), onClick: sessions.reload }}
      />
    ) : candidates.length === 0 ? (
      <div className="px-3 py-6 text-center text-caption text-fg-3">
        {query ? t('autoreply.copyDialog.noMatch', { query }) : t('autoreply.copyDialog.noOthers')}
      </div>
    ) : (
      <>
        <Virtualizer scrollRef={scrollRef} data={candidates}>
          {(s) => (
            <div key={s.id} className="pb-px">
              <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-control px-2 hover:bg-hover-5">
                <Checkbox
                  checked={picked.has(s.id)}
                  onCheckedChange={(c) => toggle(s.id, c === true)}
                  aria-label={s.title}
                />
                <Avatar id={s.id} name={s.title} src={s.avatarPath} size={28} />
                <span className="min-w-0 flex-1 truncate text-body text-fg">{s.title}</span>
                {withRule.has(s.id) ? <Badge tone="warn">{t('autoreply.copyDialog.hasRule')}</Badge> : null}
              </label>
            </div>
          )}
        </Virtualizer>
        {sessions.error ? (
          <EmptyState
            compact
            variant="error"
            title={t('autoreply.list.loadFailed')}
            description={sessions.error.message}
            action={{ label: t('common.retry'), onClick: sessions.reload }}
          />
        ) : sessions.loadingMore ? (
          <SkeletonListRows rows={1} avatar={false} className="p-2" />
        ) : null}
      </>
    )

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      icon={Copy}
      title={t('autoreply.copyDialog.title')}
      description={t('autoreply.copyDialog.description', { name: sourceTitle })}
      submitLabel={t('common.copy')}
      submitDisabled={picked.size === 0}
      submitDisabledReason={t('autoreply.copyDialog.pickOne')}
      loading={busy}
      onSubmit={submit}
    >
      <SearchBox
        size="sm"
        value={query}
        onValueChange={setQuery}
        placeholder={t('autoreply.copyDialog.search')}
        aria-label={t('autoreply.copyDialog.search')}
      />
      <div
        ref={scrollRef}
        role="group"
        aria-label={t('autoreply.copyDialog.targets')}
        onScroll={loadMoreNearEnd}
        className="flex max-h-[280px] flex-col overflow-y-auto rounded-item border border-line-6 bg-content p-1"
      >
        {listBody}
      </div>
      <div className="text-note text-fg-3">{t('autoreply.copyDialog.selected', { n: picked.size })}</div>
    </FormDialog>
  )
}
