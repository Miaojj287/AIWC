/**
 * 文件 Tab (kind 'file', objectId = path): Markdown files get a monospace editor with a live split preview,
 * dirty state (title dot via tab.dirty), 保存 / 重置; other text files are read-only; images preview inline.
 * Toolbar: 在文件夹中显示 (file:reveal). ⌘S saves.
 */
import { Columns2, Eye, FileText, FolderOpen, PenLine, RotateCcw, Save } from 'lucide-react'
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Badge, Button, EmptyState, ScrollArea, SegmentedControl, Textarea, Tooltip, cn, toast } from '@/kit'
import { detectMac } from '@/app/shortcuts'
import { useT } from '@/i18n'
import { invoke } from '@/platform/hooks'
import { formatNumber } from '@/platform/format'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { contentStats, fileName, isDirty, previewKind } from './fileModel'
import { Markdown } from './markdown'

type ViewMode = 'edit' | 'split' | 'preview'

/** `label` is a catalog key. */
const VIEW_OPTIONS = [
  { value: 'edit', label: 'common.edit', icon: PenLine },
  { value: 'split', label: 'file.view.split', icon: Columns2 },
  { value: 'preview', label: 'file.view.preview', icon: Eye },
] as const

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function FileTab({ tab, update }: TabRendererProps) {
  const t = useT()
  const path = tab.objectId
  const mac = detectMac()
  const [loaded, setLoaded] = useState<{ content: string; mediaType: string } | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const initialView = tab.state?.view
  const [view, setView] = useState<ViewMode>(
    initialView === 'edit' || initialView === 'preview' ? initialView : 'split',
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const res = await invoke('file:read', { path })
      setLoaded(res)
      setDraft(res.content)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = isDirty(loaded?.content, draft)
  useEffect(() => {
    if (Boolean(tab.dirty) !== dirty) update({ dirty })
  }, [dirty, tab.dirty, update])

  const kind = previewKind(path, loaded?.mediaType)
  const editable = kind === 'markdown'

  const save = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await invoke('file:write', { path, content: draft })
      setLoaded((prev) => (prev ? { ...prev, content: draft } : prev))
      toast.success(t('file.saved', { name: fileName(path) }))
    } catch (e) {
      toast.error(t('file.saveFailed', { detail: errText(e) }))
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, path, draft, t])

  const reveal = () =>
    void invoke('file:reveal', { path }).catch((e: unknown) =>
      toast.error(t('file.revealFailed', { detail: errText(e) })),
    )

  const onEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = mac ? e.metaKey : e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    }
  }

  const changeView = (v: ViewMode) => {
    setView(v)
    update({ state: { ...tab.state, view: v } })
  }

  const stats = contentStats(draft)

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-line-6 px-4">
        <FileText size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate text-body font-medium text-fg">{fileName(path)}</span>
          <span className="hidden min-w-0 truncate font-mono text-micro text-fg-3 md:inline" title={path}>
            {path}
          </span>
          {dirty ? <Badge tone="warn">{t('file.dirty')}</Badge> : null}
        </div>
        {editable ? (
          <SegmentedControl
            options={VIEW_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
            value={view}
            onValueChange={changeView}
            size="sm"
            aria-label={t('file.view.label')}
          />
        ) : null}
        <Tooltip content={t('file.reveal')}>
          <Button variant="ghost" size="sm" icon={FolderOpen} onClick={reveal}>
            {t('file.reveal')}
          </Button>
        </Tooltip>
        {editable ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              disabled={!dirty || saving}
              onClick={() => setDraft(loaded?.content ?? '')}
            >
              {t('common.reset')}
            </Button>
            <Tooltip content={t('common.save')} kbd={mac ? '⌘S' : 'Ctrl+S'} disabled={!dirty}>
              <span className="inline-flex">
                <Button size="sm" icon={Save} disabled={!dirty} loading={saving} onClick={() => void save()}>
                  {t('common.save')}
                </Button>
              </span>
            </Tooltip>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState variant="loading" title={t('file.loading')} />
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            variant="error"
            title={t('file.loadFailed')}
            description={error}
            action={{ label: t('common.retry'), onClick: () => void load() }}
            secondaryAction={{ label: t('file.reveal'), onClick: reveal }}
          />
        </div>
      ) : kind === 'markdown' ? (
        <div className="flex min-h-0 flex-1">
          {view !== 'preview' ? (
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-col',
                view === 'split' ? 'flex-1 border-r border-line-6' : 'flex-1',
              )}
            >
              <Textarea
                mono
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditorKeyDown}
                spellCheck={false}
                aria-label={t('file.editorLabel')}
                wrapperClassName="min-h-0 flex-1"
                className="h-full min-h-0 resize-none rounded-none border-0 bg-content px-5 py-4 leading-[20px] focus:border-0"
              />
              <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line-6 px-4 font-latin text-micro text-fg-3">
                <span>{t('file.chars', { n: stats.chars, count: formatNumber(stats.chars) })}</span>
                <span>{t('file.lines', { n: stats.lines, count: formatNumber(stats.lines) })}</span>
                <span className="ml-auto">Markdown · UTF-8</span>
              </div>
            </div>
          ) : null}
          {view !== 'edit' ? (
            <ScrollArea className={cn('min-h-0 min-w-0', view === 'split' ? 'flex-1' : 'flex-1')}>
              <div className="mx-auto w-full max-w-[760px] px-8 py-6">
                {draft.trim() ? (
                  <Markdown source={draft} />
                ) : (
                  <EmptyState compact title={t('file.emptyFile')} description={t('file.emptyFileHint')} />
                )}
              </div>
            </ScrollArea>
          ) : null}
        </div>
      ) : kind === 'text' ? (
        <ScrollArea className="min-h-0 flex-1">
          <pre className="select-text whitespace-pre-wrap break-words px-5 py-4 font-mono text-caption leading-[18px] text-fg-2">
            {loaded?.content}
          </pre>
        </ScrollArea>
      ) : kind === 'image' && loaded?.content.startsWith('data:') ? (
        <div className="flex flex-1 items-center justify-center overflow-auto p-6">
          <img
            src={loaded.content}
            alt={fileName(path)}
            className="max-h-full max-w-full rounded-item object-contain"
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title={t('file.unsupported')}
            description={loaded?.mediaType ?? t('file.unknownType')}
            action={{ label: t('file.reveal'), onClick: reveal, variant: 'ghost' }}
          />
        </div>
      )}
    </div>
  )
}
