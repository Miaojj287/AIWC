/**
 * 日记 Tab (kind 'diary', objectId 'diary'): left 200 nav of dates grouped by month, right reader with the
 * Markdown body and the 记忆线索 cues as chips; header 重新生成 (progress dialog fed by diary:progress) and
 * 设置 (→ tab.openSettings memory). Empty state offers 生成今天的日记.
 */
import { AtSign, BookOpen, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { formatClock } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { Markdown } from '@/features/file'
import { diaryDateLabel, diaryTitle, groupByMonth, pickInitialDate, sourcesSummary, splitCues, todayKey } from './diaryModel'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Generation {
  date: string
  step: string
  fraction: number
}

export function DiaryTab({ tab, update }: TabRendererProps) {
  const listQ = useInvoke('diary:list', undefined, [])
  const items = listQ.data ?? []
  const requested = typeof tab.state?.date === 'string' ? tab.state.date : undefined
  const [selected, setSelected] = useState<string | undefined>(requested)
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [regenConfirm, setRegenConfirm] = useState(false)

  // Pick the requested / newest date once the list is known; follow later `tab.openDiary {date}` requests.
  useEffect(() => {
    if (listQ.loading) return
    const next = pickInitialDate(items, requested ?? selected)
    if (next !== selected) setSelected(next)
    // `items` is derived from listQ.data; `selected` is intentionally read, not tracked (user choice wins).
  }, [listQ.loading, listQ.data, requested])

  const select = useCallback(
    (date: string) => {
      setSelected(date)
      update({ state: { ...tab.state, date } })
    },
    [update, tab.state],
  )

  const entryQ = useInvoke('diary:get', { date: selected ?? '' }, [selected], { enabled: Boolean(selected) })
  const entry = entryQ.data
  const groups = useMemo(() => groupByMonth(items), [items])

  useBridgeEvent('diary:progress', (p) => {
    setGeneration((g) => (g && g.date === p.date ? { ...g, step: p.step, fraction: p.fraction } : g))
  })

  const generate = useCallback(
    async (date: string, force: boolean) => {
      setGeneration({ date, step: '准备中', fraction: 0 })
      try {
        const res: DiaryEntry = await invoke('diary:generate', { date, force })
        setGeneration(null)
        listQ.reload()
        select(res.date)
        if (res.date === selected) entryQ.reload()
        toast.success(`已生成 ${diaryDateLabel(res.date)} 的日记${res.degraded ? '（降级版）' : ''}`)
      } catch (e) {
        setGeneration(null)
        toast.error(`生成失败：${errText(e)}`, { action: { label: '重试', onClick: () => void generate(date, force) } })
      }
    },
    [listQ, select, selected, entryQ],
  )

  const openSettings = () => runCommand('tab.openSettings', { page: 'memory' })
  const quoteDiary = (date: string) => {
    runCommand('agent.quote', { kind: 'memory', id: `diary:${date}`, label: `日记 ${date}` })
    toast.success(`已把 ${diaryDateLabel(date)} 的日记加入当前 Agent 会话上下文`)
  }
  const menuFor = (date: string): MenuSpec => [
    { id: 'regen', label: '重新生成', icon: RefreshCw, onSelect: () => void generate(date, true) },
    { type: 'separator' },
    { id: 'quote', label: '引用到 Agent', icon: AtSign, onSelect: () => quoteDiary(date) },
  ]

  const today = todayKey()
  const hasToday = items.some((i) => i.date === today)

  return (
    <div className="flex h-full min-h-0 bg-content">
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-line-6 bg-panel">
        <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-line-6 px-3">
          <span className="text-body font-medium text-fg">日记</span>
          <span className="font-latin text-micro text-fg-3">{items.length ? `${items.length} 篇` : ''}</span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-2">
            {listQ.loading && !listQ.data ? (
              <SkeletonListRows rows={5} avatar={false} className="px-1 pt-1" />
            ) : listQ.error ? (
              <EmptyState compact variant="error" title="无法读取日记列表" description={listQ.error.message} action={{ label: '重试', onClick: listQ.reload }} />
            ) : groups.length === 0 ? (
              <EmptyState compact title="还没有日记" description="生成后会按月份列在这里" />
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
                              {it.degraded ? <Badge tone="warn">降级</Badge> : null}
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
          <Button variant="ghost" size="sm" icon={Sparkles} className="w-full" onClick={() => void generate(today, hasToday)} disabled={generation !== null}>
            {hasToday ? '重新生成今天' : '生成今天的日记'}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate text-bubble font-medium leading-5 text-fg">{selected ? diaryTitle(selected) : '日记'}</span>
              {entry?.degraded ? <Badge tone="warn">降级生成</Badge> : null}
            </div>
            <span className="truncate text-caption leading-4 text-fg-3">{entry ? sourcesSummary(entry, formatClock) : '由 Agent 在每天设定的时间自动整理当天的聊天记录'}</span>
          </div>
          {selected ? (
            <>
              <Tooltip content="引用到 Agent">
                <IconButton icon={AtSign} label="引用到 Agent" onClick={() => quoteDiary(selected)} />
              </Tooltip>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => setRegenConfirm(true)} disabled={generation !== null}>
                重新生成
              </Button>
            </>
          ) : null}
          <Tooltip content="日记设置">
            <IconButton icon={Settings} label="日记设置" onClick={openSettings} />
          </Tooltip>
        </div>

        {items.length === 0 && !listQ.loading && !listQ.error ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={BookOpen}
              title="还没有日记"
              description="日记会在每天设定的时间自动生成，整理当天的聊天与 Agent 对话，并把线索回灌到记忆。也可以现在就生成今天的。"
              action={{ label: '生成今天的日记', icon: Sparkles, onClick: () => void generate(today, false) }}
              secondaryAction={{ label: '日记设置', icon: Settings, onClick: openSettings }}
            />
          </div>
        ) : !selected ? null : entryQ.loading && !entry ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState variant="loading" title="正在读取日记…" />
          </div>
        ) : entryQ.error ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState variant="error" title="无法读取这一天的日记" description={entryQ.error.message} action={{ label: '重试', onClick: entryQ.reload }} />
          </div>
        ) : !entry ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState title="这一天还没有日记" description={diaryTitle(selected)} action={{ label: '生成这一天的日记', icon: Sparkles, onClick: () => void generate(selected, false) }} />
          </div>
        ) : (
          <DiaryReader entry={entry} />
        )}
      </div>

      <ProgressDialog
        open={generation !== null}
        icon={Sparkles}
        title={generation ? `正在生成 ${diaryDateLabel(generation.date)} 的日记` : '正在生成日记'}
        description="选材 → 按会话小结 → 日综合 → 写入记忆线索。全程在本机与你配置的模型之间完成。"
        value={generation ? Math.round(generation.fraction * 100) : undefined}
        status={generation?.step}
      />
      <ConfirmDialog
        open={regenConfirm}
        onOpenChange={setRegenConfirm}
        icon={RefreshCw}
        tone="warn"
        title="重新生成这一天的日记？"
        description="会用当前的聊天记录重新整理并覆盖现有内容，记忆线索也会更新。"
        confirmLabel="重新生成"
        onConfirm={() => {
          setRegenConfirm(false)
          if (selected) void generate(selected, true)
        }}
      />
    </div>
  )
}

function DiaryReader({ entry }: { entry: DiaryEntry }) {
  const { body, cues } = useMemo(() => splitCues(entry.markdown, entry.cues), [entry])
  return (
    <ScrollArea className="min-h-0 flex-1">
      <article className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-8 py-6">
        {body ? <Markdown source={body} /> : <EmptyState compact title="这一天没有可整理的内容" />}
        {cues.length > 0 ? (
          <section className="flex flex-col gap-2.5 border-t border-line-6 pt-5">
            <div className="flex items-center gap-2">
              <span className="text-body font-medium text-fg">记忆线索</span>
              <span className="text-note text-fg-3">写给 Agent 的检索提示，已回灌到 MEMORY</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cues.map((c, i) => (
                <Chip key={`${i}-${c}`} label={c} tabIndex={-1} className="h-auto cursor-default whitespace-normal py-1 text-left" />
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </ScrollArea>
  )
}
