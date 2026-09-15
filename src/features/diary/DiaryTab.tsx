/**
 * 日记 Tab (kind 'diary', objectId 'diary'): left 200 nav of dates grouped by month, right reader with the
 * Markdown body and the 记忆线索 cues as chips; header 重新生成 (progress dialog fed by diary:progress) and
 * 设置 (→ tab.openSettings memory). Empty state offers 生成今天的日记. Every 重新生成 — header, date
 * menu, 重新生成今天 — overwrites an entry, so all of them go through the one confirm dialog.
 */
import { AtSign, BookOpen, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { DiaryEntry } from '@aiwc/protocol'
import {
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  EmptyState,
  IconButton,
  ListItem,
  ProgressDialog,
  ScrollArea,
  SkeletonListRows,
  Tooltip,
  toast,
  type MenuSpec,
} from '@/kit'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { formatClock } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { Markdown } from '@/features/file'
import {
  diaryDateLabel,
  diaryTitle,
  groupByMonth,
  pickInitialDate,
  sourcesSummary,
  splitCues,
  todayKey,
} from './diaryModel'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Generation {
  date: string
  step: string
  fraction: number
}

export function DiaryTab({ tab, update }: TabRendererProps) {
  const t = useT()
  const listQ = useInvoke('diary:list', undefined, [])
  const items = listQ.data ?? []
  const requested = typeof tab.state?.date === 'string' ? tab.state.date : undefined
  const [selected, setSelected] = useState<string | undefined>(requested)
  const [generation, setGeneration] = useState<Generation | null>(null)
  /** Date whose existing entry the confirm dialog is about to overwrite. */
  const [regenTarget, setRegenTarget] = useState<string | null>(null)

  // Pick the requested / newest date once the list is known; follow later `tab.openDiary {date}` requests.
  // `selected` is read, not tracked: once the user picks a date, their choice wins until a new request arrives.
  const syncSelection = useEffectEvent(() => {
    const next = pickInitialDate(items, requested ?? selected)
    if (next !== selected) setSelected(next)
  })
  const listLoading = listQ.loading
  useEffect(() => {
    if (!listLoading) syncSelection()
  }, [listLoading, listQ.data, requested])

  const select = useCallback(
    (date: string) => {
      setSelected(date)
      update({ state: { ...tab.state, date } })
    },
    [update, tab.state],
  )

  const entryQ = useInvoke('diary:get', { date: selected ?? '' }, [selected], { enabled: Boolean(selected) })
  const entry = entryQ.data
  // Not memoized: the month labels follow the UI language.
  const groups = groupByMonth(items)

  useBridgeEvent('diary:progress', (p) => {
    setGeneration((g) => (g && g.date === p.date ? { ...g, step: p.step, fraction: p.fraction } : g))
  })

  const generate = useCallback(
    async (date: string, force: boolean) => {
      setGeneration({ date, step: t('diary.generation.preparing'), fraction: 0 })
      try {
        const res: DiaryEntry = await invoke('diary:generate', { date, force })
        setGeneration(null)
        listQ.reload()
        select(res.date)
        if (res.date === selected) entryQ.reload()
        toast.success(t('diary.generation.done', { date: diaryDateLabel(res.date), degraded: Boolean(res.degraded) }))
      } catch (e) {
        setGeneration(null)
        toast.error(t('diary.generation.failed', { detail: errText(e) }), {
          action: { label: t('common.retry'), onClick: () => void generate(date, force) },
        })
      }
    },
    [listQ, select, selected, entryQ, t],
  )

  const openSettings = () => runCommand('tab.openSettings', { page: 'memory' })
  const quoteDiary = (date: string) => {
    runCommand('agent.quote', { kind: 'memory', id: `diary:${date}`, label: t('diary.quoteLabel', { date }) })
    toast.success(t('diary.quoted', { date: diaryDateLabel(date) }))
  }
  const menuFor = (date: string): MenuSpec => [
    { id: 'regen', label: t('diary.regenerate'), icon: RefreshCw, onSelect: () => setRegenTarget(date) },
    { type: 'separator' },
    { id: 'quote', label: t('diary.quote'), icon: AtSign, onSelect: () => quoteDiary(date) },
  ]

  const today = todayKey()
  const hasToday = items.some((i) => i.date === today)
  const todayLabel = hasToday ? t('diary.nav.regenerateToday') : t('diary.generateToday')

  return (
    <div className="flex h-full min-h-0 bg-content">
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-line-6 bg-panel">
        <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-line-6 px-3">
          <span className="text-body font-medium text-fg">{t('diary.nav.title')}</span>
          <span className="font-latin text-micro text-fg-3">
            {items.length ? t('diary.nav.count', { n: items.length }) : ''}
          </span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-2">
            {listQ.loading && !listQ.data ? (
              <SkeletonListRows rows={5} avatar={false} className="px-1 pt-1" />
            ) : listQ.error ? (
              <EmptyState
                compact
                variant="error"
                title={t('diary.nav.loadFailed')}
                description={listQ.error.message}
                action={{ label: t('common.retry'), onClick: listQ.reload }}
              />
            ) : groups.length === 0 ? (
              <EmptyState compact title={t('diary.empty.title')} description={t('diary.nav.emptyHint')} />
            ) : (
              groups.map((g) => (
                <section key={g.key} className="flex flex-col gap-0.5">
                  <div className="px-2 pb-1 pt-0.5 font-latin text-micro font-medium text-fg-3">{g.label}</div>
                  {g.items.map((it) => (
                    <ContextMenu key={it.date}>
                      <ContextMenuTrigger asChild>
                        <ListItem
                          dense
                          title={diaryDateLabel(it.date)}
                          subtitle={
                            <>
                              <span className="font-latin">{it.date}</span>
                              {it.degraded ? <Badge tone="warn">{t('diary.degraded')}</Badge> : null}
                            </>
                          }
                          selected={it.date === selected}
                          onSelect={() => select(it.date)}
                        />
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItems items={menuFor(it.date)} />
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </section>
              ))
            )}
          </div>
        </ScrollArea>
        <div className="shrink-0 border-t border-line-6 p-2">
          <Button
            variant="ghost"
            size="sm"
            icon={Sparkles}
            className="w-full"
            onClick={() => {
              if (hasToday) setRegenTarget(today)
              else void generate(today, false)
            }}
            disabled={generation !== null}
            title={todayLabel}
          >
            <span className="min-w-0 truncate">{todayLabel}</span>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-bubble font-medium leading-5 text-fg">
                {selected ? diaryTitle(selected) : t('diary.header.title')}
              </span>
              {entry?.degraded ? <Badge tone="warn">{t('diary.degradedEntry')}</Badge> : null}
            </div>
            <span className="truncate text-caption leading-4 text-fg-3">
              {entry ? sourcesSummary(entry, formatClock) : t('diary.header.schedule')}
            </span>
          </div>
          {selected ? (
            <>
              <Tooltip content={t('diary.quote')}>
                <IconButton icon={AtSign} label={t('diary.quote')} onClick={() => quoteDiary(selected)} />
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                icon={RefreshCw}
                onClick={() => setRegenTarget(selected)}
                disabled={generation !== null}
              >
                {t('diary.regenerate')}
              </Button>
            </>
          ) : null}
          <Tooltip content={t('diary.settings')}>
            <IconButton icon={Settings} label={t('diary.settings')} onClick={openSettings} />
          </Tooltip>
        </div>

        {items.length === 0 && !listQ.loading && !listQ.error ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={BookOpen}
              title={t('diary.empty.title')}
              description={t('diary.empty.description')}
              action={{ label: t('diary.generateToday'), icon: Sparkles, onClick: () => void generate(today, false) }}
              secondaryAction={{ label: t('diary.settings'), icon: Settings, onClick: openSettings }}
            />
          </div>
        ) : !selected ? null : entryQ.loading && !entry ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState variant="loading" title={t('diary.reader.loading')} />
          </div>
        ) : entryQ.error ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              variant="error"
              title={t('diary.reader.loadFailed')}
              description={entryQ.error.message}
              action={{ label: t('common.retry'), onClick: entryQ.reload }}
            />
          </div>
        ) : !entry ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title={t('diary.reader.missing')}
              description={diaryTitle(selected)}
              action={{
                label: t('diary.reader.generateDay'),
                icon: Sparkles,
                onClick: () => void generate(selected, false),
              }}
            />
          </div>
        ) : (
          <DiaryReader entry={entry} />
        )}
      </div>

      <ProgressDialog
        open={generation !== null}
        icon={Sparkles}
        title={
          generation
            ? t('diary.generation.title', { date: diaryDateLabel(generation.date) })
            : t('diary.generation.titleGeneric')
        }
        description={t('diary.generation.description')}
        value={generation ? Math.round(generation.fraction * 100) : undefined}
        status={generation?.step}
      />
      <ConfirmDialog
        open={regenTarget !== null}
        onOpenChange={(o) => !o && setRegenTarget(null)}
        icon={RefreshCw}
        tone="warn"
        title={t('diary.regenerateConfirm.title', { date: regenTarget ? diaryDateLabel(regenTarget) : '' })}
        description={t('diary.regenerateConfirm.description')}
        confirmLabel={t('diary.regenerate')}
        onConfirm={() => {
          const date = regenTarget
          setRegenTarget(null)
          if (date) void generate(date, true)
        }}
      />
    </div>
  )
}

function DiaryReader({ entry }: { entry: DiaryEntry }) {
  const t = useT()
  const { body, cues } = useMemo(() => splitCues(entry.markdown, entry.cues), [entry])
  return (
    <ScrollArea className="min-h-0 flex-1">
      <article className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-8 py-6">
        {body ? <Markdown source={body} /> : <EmptyState compact title={t('diary.reader.nothing')} />}
        {cues.length > 0 ? (
          <section className="flex flex-col gap-2.5 border-t border-line-6 pt-5">
            <div className="flex items-center gap-2">
              <span className="text-body font-medium text-fg">{t('diary.reader.cues')}</span>
              <span className="text-note text-fg-3">{t('diary.reader.cuesSaved')}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cues.map((c, i) => (
                <Chip
                  key={`${i}-${c}`}
                  label={c}
                  tabIndex={-1}
                  className="h-auto cursor-default whitespace-normal py-1 text-left"
                />
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </ScrollArea>
  )
}
