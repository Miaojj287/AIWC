/**
 * 文件 Tab (kind 'file', objectId = path): Markdown files get a monospace editor with a live split preview,
 * dirty state (title dot via tab.dirty), 保存 / 重置. Everything else is a read-only preview: text, CSV / TSV
 * and Excel as tables, Word, PDF, images, audio / video, and HTML in an isolated frame (FilePreviews.tsx,
 * PdfPreview.tsx). Header (72px like every object tab): tile · name + path · view switch · 用默认应用打开 ·
 * 在文件夹中显示 (file:reveal) · 重置 / 保存; the controls wrap under the name when the tab is narrow (the Agent
 * window's workspace column). ⌘S saves.
 */
import { Columns2, ExternalLink, Eye, FileText, FolderOpen, PenLine, RotateCcw, Save, TextQuote } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { DocumentPreview } from '@aiwc/protocol'
import {
  Badge,
  Button,
  EmptyState,
  ICON_STROKE,
  Markdown,
  ScrollArea,
  SegmentedControl,
  SelectionAction,
  Textarea,
  Tooltip,
  cn,
  toast,
  type MarkdownTableActions,
} from '@/kit'
import { runCommand } from '@/app/commands'
import { detectMac } from '@/app/shortcuts'
import { useT } from '@/i18n'
import { invoke } from '@/platform/hooks'
import { quoteScopeProps } from '@/platform/focusScope'
import { formatNumber } from '@/platform/format'
import { toMediaUrl } from '@/platform/mediaUrl'
import { openLocalPath, openTarget } from '@/platform/openExternal'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { base64ToBytes, contentStats, fileName, isDirty, previewKind, previewSource, toDataUrl } from './fileModel'
import { CsvPreview, DocumentView, HtmlPreview, ImagePreview, MediaPreview } from './FilePreviews'
import { PdfPreview } from './PdfPreview'

type ViewMode = 'edit' | 'split' | 'preview'

/** The preview's tables offer the two copy actions; saving a CSV is an Agent-reply action. */
const PREVIEW_TABLE_ACTIONS: MarkdownTableActions = { copy: true }

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
  // Text selected in the preview can be quoted to the Agent (引用到 Agent), with this file as the source.
  const quoteRef = useRef<HTMLDivElement>(null)
  const source = previewSource(previewKind(path), path)
  const [loaded, setLoaded] = useState<{ content: string; mediaType: string } | undefined>()
  const [officeDoc, setOfficeDoc] = useState<DocumentPreview | undefined>()
  const [loading, setLoading] = useState(source === 'read' || source === 'document')
  const [error, setError] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const initialView = tab.state?.view
  const [view, setView] = useState<ViewMode>(
    initialView === 'edit' || initialView === 'preview' ? initialView : 'split',
  )

  const load = useCallback(async () => {
    // Audio / video stream from the aiwc-media protocol (range requests): nothing to load up front.
    // Known binaries (archives, installers) are not read at all: the Tab offers the default app.
    if (source === 'stream' || source === 'none') return
    setLoading(true)
    setError(undefined)
    try {
      if (source === 'document') {
        setOfficeDoc(await invoke('file:previewDocument', { path }))
      } else {
        const res = await invoke('file:read', { path })
        setLoaded(res)
        setDraft(res.content)
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [path, source])

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

  const openExternally = () => void openLocalPath(path, t('file.openTarget'))

  const reveal = () =>
    void invoke('file:reveal', { path }).catch((e: unknown) =>
      toast.error(t('file.revealFailed', { detail: errText(e) })),
    )

  /** Preview links open through the shell (browser or default app), never by navigating the renderer. */
  const openLink = useCallback((href: string) => void openTarget(href, t('file.markdown.link')), [t])

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
  // file:read hands binaries over as bare base64; the image and PDF views need a data URL / bytes.
  const imageSrc = useMemo(
    () => (kind === 'image' && loaded ? toDataUrl(loaded.content, loaded.mediaType) : undefined),
    [kind, loaded],
  )
  const pdfBytes = useMemo(() => (kind === 'pdf' && loaded ? base64ToBytes(loaded.content) : undefined), [kind, loaded])

  return (
    <div
      ref={quoteRef}
      className="flex h-full min-h-0 flex-col bg-content"
      {...quoteScopeProps({ kind: 'file', id: path, label: fileName(path) })}
    >
      <SelectionAction
        containerRef={quoteRef}
        icon={TextQuote}
        label={t('file.quoteSelection')}
        onAction={(text) =>
          runCommand('agent.quoteText', { text, source: { kind: 'file', id: path, label: fileName(path) } })
        }
      />
      <div className="flex min-h-18 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-6 px-5 py-3">
        <div className="flex min-w-40 flex-1 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-item bg-hover-7 text-fg-2"
          >
            <FileText size={18} strokeWidth={ICON_STROKE} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-bubble font-semibold leading-5 text-fg" title={fileName(path)}>
                {fileName(path)}
              </span>
              {dirty ? <Badge tone="warn">{t('file.dirty')}</Badge> : null}
            </div>
            {/* The second line, like the chat header's meta: always there, so no breakpoint decides whether the
                path is visible. It truncates at the tail and keeps the whole path in `title`. */}
            <span className="truncate font-mono text-micro leading-4 text-fg-3" title={path}>
              {path}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <SegmentedControl
              options={VIEW_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
              value={view}
              onValueChange={changeView}
              size="sm"
              aria-label={t('file.view.label')}
            />
          ) : null}
          {!editable ? (
            <Button variant="ghost" size="sm" icon={ExternalLink} onClick={openExternally}>
              {t('file.openExternally')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" icon={FolderOpen} onClick={reveal}>
            {t('file.reveal')}
          </Button>
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
              {/* Enabled: the shortcut. Disabled: the button says why itself (`disabledReason`). */}
              <Tooltip content={t('common.save')} kbd={mac ? '⌘S' : 'Ctrl+S'} disabled={!dirty}>
                <Button
                  size="sm"
                  icon={Save}
                  disabled={!dirty}
                  disabledReason={t('file.nothingToSave')}
                  loading={saving}
                  onClick={() => void save()}
                >
                  {t('common.save')}
                </Button>
              </Tooltip>
            </>
          ) : null}
        </div>
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
                className="h-full min-h-0 resize-none rounded-none border-0 bg-content px-5 py-4 leading-5 focus:border-0"
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
                  <Markdown
                    source={draft}
                    onLink={openLink}
                    tableActions={PREVIEW_TABLE_ACTIONS}
                    className="select-text"
                  />
                ) : (
                  <EmptyState compact title={t('file.emptyFile')} description={t('file.emptyFileHint')} />
                )}
              </div>
            </ScrollArea>
          ) : null}
        </div>
      ) : kind === 'text' ? (
        <ScrollArea className="min-h-0 flex-1">
          <pre className="select-text whitespace-pre-wrap break-words px-5 py-4 font-mono text-caption leading-4.5 text-fg-2">
            {loaded?.content}
          </pre>
        </ScrollArea>
      ) : kind === 'csv' && loaded ? (
        <CsvPreview path={path} text={loaded.content} />
      ) : kind === 'html' && loaded ? (
        <HtmlPreview source={loaded.content} title={fileName(path)} />
      ) : kind === 'image' && imageSrc ? (
        <ImagePreview src={imageSrc} alt={fileName(path)} />
      ) : kind === 'pdf' && pdfBytes ? (
        <PdfPreview data={pdfBytes} />
      ) : (kind === 'audio' || kind === 'video') && source === 'stream' ? (
        <MediaPreview kind={kind} src={toMediaUrl(path) ?? path} title={fileName(path)} />
      ) : (kind === 'docx' || kind === 'xlsx') && officeDoc ? (
        <DocumentView preview={officeDoc} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title={t('file.unsupported')}
            description={loaded?.mediaType ?? t('file.unknownType')}
            action={{ label: t('file.openExternally'), onClick: openExternally, variant: 'ghost' }}
            secondaryAction={{ label: t('file.reveal'), onClick: reveal }}
          />
        </div>
      )}
    </div>
  )
}
