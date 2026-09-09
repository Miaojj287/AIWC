/**
 * 文件 Tab (kind 'file', objectId = path): Markdown files get a monospace editor with a live split preview,
 * dirty state (title dot via tab.dirty), 保存 / 重置; other text files are read-only; images preview inline.
 * Toolbar: 在文件夹中显示 (file:reveal). ⌘S saves.
 */
import { Columns2, Eye, FileText, FolderOpen, PenLine, RotateCcw, Save } from 'lucide-react'
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Badge, Button, EmptyState, ScrollArea, SegmentedControl, Textarea, Tooltip, cn, toast } from '@/kit'
import { detectMac } from '@/app/shortcuts'
import { invoke } from '@/platform/hooks'
import { formatNumber } from '@/platform/format'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { contentStats, fileName, isDirty, previewKind } from './fileModel'
import { Markdown } from './markdown'

type ViewMode = 'edit' | 'split' | 'preview'

const VIEW_OPTIONS = [
  { value: 'edit' as const, label: '编辑', icon: PenLine },
  { value: 'split' as const, label: '分栏', icon: Columns2 },
  { value: 'preview' as const, label: '预览', icon: Eye },
]

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function FileTab({ tab, update }: TabRendererProps) {
  const path = tab.objectId
  const mac = detectMac()
  const [loaded, setLoaded] = useState<{ content: string; mediaType: string } | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const initialView = tab.state?.view
  const [view, setView] = useState<ViewMode>(initialView === 'edit' || initialView === 'preview' ? initialView : 'split')

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
      toast.success(`已保存 ${fileName(path)}`)
    } catch (e) {
      toast.error(`保存失败：${errText(e)}`)
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, path, draft])

  const reveal = () => void invoke('file:reveal', { path }).catch((e: unknown) => toast.error(`无法打开所在文件夹：${errText(e)}`))

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
          <span className="truncate text-body font-medium text-fg">{fileName(path)}</span>
          <span className="hidden min-w-0 truncate font-mono text-micro text-fg-3 md:inline" title={path}>
            {path}
          </span>
          {dirty ? <Badge tone="warn">已修改 · 未保存</Badge> : null}
        </div>
        {editable ? <SegmentedControl options={VIEW_OPTIONS} value={view} onValueChange={changeView} size="sm" aria-label="视图" /> : null}
        <Tooltip content="在文件夹中显示">
          <Button variant="ghost" size="sm" icon={FolderOpen} onClick={reveal}>
            在文件夹中显示
          </Button>
        </Tooltip>
        {editable ? (
          <>
            <Button variant="ghost" size="sm" icon={RotateCcw} disabled={!dirty || saving} onClick={() => setDraft(loaded?.content ?? '')}>
              重置
            </Button>
            <Tooltip content="保存" kbd={mac ? '⌘S' : 'Ctrl+S'} disabled={!dirty}>
              <span className="inline-flex">
                <Button size="sm" icon={Save} disabled={!dirty} loading={saving} onClick={() => void save()}>
                  保存
                </Button>
              </span>
            </Tooltip>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState variant="loading" title="正在读取文件…" />
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState variant="error" title="无法读取文件" description={error} action={{ label: '重试', onClick: () => void load() }} secondaryAction={{ label: '在文件夹中显示', onClick: reveal }} />
        </div>
      ) : kind === 'markdown' ? (
        <div className="flex min-h-0 flex-1">
          {view !== 'preview' ? (
            <div className={cn('flex min-h-0 min-w-0 flex-col', view === 'split' ? 'flex-1 border-r border-line-6' : 'flex-1')}>
              <Textarea
                mono
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditorKeyDown}
                spellCheck={false}
                aria-label="Markdown 编辑器"
                wrapperClassName="min-h-0 flex-1"
                className="h-full min-h-0 resize-none rounded-none border-0 bg-content px-5 py-4 leading-[20px] focus:border-0"
              />
              <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line-6 px-4 font-latin text-micro text-fg-3">
                <span>{formatNumber(stats.chars)} 字</span>
                <span>{formatNumber(stats.lines)} 行</span>
                <span className="ml-auto">Markdown · UTF-8</span>
              </div>
            </div>
          ) : null}
          {view !== 'edit' ? (
            <ScrollArea className={cn('min-h-0 min-w-0', view === 'split' ? 'flex-1' : 'flex-1')}>
              <div className="mx-auto w-full max-w-[760px] px-8 py-6">
                {draft.trim() ? <Markdown source={draft} /> : <EmptyState compact title="空文件" description="在左侧开始输入，这里会实时预览" />}
              </div>
            </ScrollArea>
          ) : null}
        </div>
      ) : kind === 'text' ? (
        <ScrollArea className="min-h-0 flex-1">
          <pre className="select-text whitespace-pre-wrap break-words px-5 py-4 font-mono text-caption leading-[18px] text-fg-2">{loaded?.content}</pre>
        </ScrollArea>
      ) : kind === 'image' && loaded?.content.startsWith('data:') ? (
        <div className="flex flex-1 items-center justify-center overflow-auto p-6">
          <img src={loaded.content} alt={fileName(path)} className="max-h-full max-w-full rounded-item object-contain" />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState title="暂不支持预览此类型" description={loaded?.mediaType ?? '未知类型'} action={{ label: '在文件夹中显示', onClick: reveal, variant: 'ghost' }} />
        </div>
      )}
    </div>
  )
}
