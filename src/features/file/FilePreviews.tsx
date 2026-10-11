/**
 * Read-only bodies of the file Tab, one per preview kind (the Markdown editor stays in FileTab.tsx, PDF in
 * PdfPreview.tsx): image (fit), CSV / TSV and Excel as tables, HTML in an isolated frame, audio / video
 * players, Word as headings / paragraphs / lists / tables. Tables and headings reuse the Markdown look
 * (MARKDOWN_CLASS): a table is the same thing wherever it appears.
 */
import { FileWarning, ImageIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { DocBlock, DocRun, DocumentPreview } from '@aiwc/protocol'
import {
  EmptyState,
  ICON_STROKE,
  InlineHint,
  MARKDOWN_CLASS,
  MARKDOWN_HEADING_CLASS,
  ScrollArea,
  Select,
  ZoomPan,
  cn,
} from '@/kit'
import { useT } from '@/i18n'
import { delimiterFor, parseDelimited } from './csv'
import { isolatedHtml } from './fileModel'

/** An image file: fitted, then zoom (wheel / pinch / + −) and pan (drag); double-click or 0 resets. */
export function ImagePreview({ src, alt }: { src: string; alt: string }) {
  return (
    <ZoomPan label={alt} className="min-h-0 flex-1 bg-panel">
      <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full rounded-item object-contain" />
    </ZoomPan>
  )
}

/** A plain grid in the Markdown table look; the first row is the header. */
function Grid({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const pad = (r: string[]) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r)
  return (
    <div className={MARKDOWN_CLASS.tableFrame}>
      <table className={MARKDOWN_CLASS.table}>
        {head ? (
          <thead>
            <tr className={MARKDOWN_CLASS.tableHeadRow}>
              {pad(head).map((cell, i) => (
                <th key={i} scope="col" className={cn(MARKDOWN_CLASS.tableHeader, 'text-left')}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className={MARKDOWN_CLASS.tableRow}>
              {pad(row).map((cell, c) => (
                <td key={c} className={cn(MARKDOWN_CLASS.tableCell, 'max-w-[320px] whitespace-pre-wrap text-fg-2')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableBody({ rows, truncated, emptyTitle }: { rows: string[][]; truncated: boolean; emptyTitle: string }) {
  const t = useT()
  if (!rows.length)
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState compact title={emptyTitle} />
      </div>
    )
  return (
    <ScrollArea className="min-h-0 flex-1" orientation="both">
      <div className="flex flex-col gap-3 px-5 py-4">
        {truncated ? <InlineHint kind="info">{t('file.table.truncated', { n: rows.length })}</InlineHint> : null}
        <Grid rows={rows} />
      </div>
    </ScrollArea>
  )
}

export function CsvPreview({ path, text }: { path: string; text: string }) {
  const t = useT()
  const table = useMemo(() => parseDelimited(text, delimiterFor(path)), [path, text])
  return <TableBody rows={table.rows} truncated={table.truncated} emptyTitle={t('file.emptyFile')} />
}

export function HtmlPreview({ source, title }: { source: string; title: string }) {
  const doc = useMemo(() => isolatedHtml(source), [source])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Empty sandbox: no scripts, forms, popups or same-origin access; the CSP inside blocks the network. */}
      <iframe
        title={title}
        sandbox=""
        srcDoc={doc}
        referrerPolicy="no-referrer"
        className="m-5 min-h-0 flex-1 rounded-item border border-line-8 bg-white"
      />
    </div>
  )
}

export function MediaPreview({ kind, src, title }: { kind: 'audio' | 'video'; src: string; title: string }) {
  const t = useT()
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          variant="error"
          icon={FileWarning}
          title={t('file.media.failed')}
          description={t('file.media.failedHint')}
        />
      </div>
    )
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-panel p-6">
      {kind === 'video' ? (
        <video
          src={src}
          controls
          preload="metadata"
          aria-label={title}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full rounded-item"
        />
      ) : (
        <audio
          src={src}
          controls
          preload="metadata"
          aria-label={title}
          onError={() => setFailed(true)}
          className="w-full max-w-[520px]"
        />
      )}
    </div>
  )
}

function Runs({ runs }: { runs: DocRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = r.text
        if (r.italic) node = <em>{node}</em>
        if (r.bold) node = <strong className={MARKDOWN_CLASS.strong}>{node}</strong>
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

/**
 * The marker of each list item: running numbers per level for numbered lists (restarting after any
 * other block), a bullet otherwise.
 */
export function listMarkers(blocks: readonly DocBlock[]): (string | undefined)[] {
  let counters: number[] = []
  return blocks.map((block) => {
    if (block.type !== 'listItem') {
      counters = []
      return undefined
    }
    if (!block.ordered) return '•'
    counters = counters.slice(0, block.level + 1)
    while (counters.length <= block.level) counters.push(0)
    counters[block.level] = (counters[block.level] ?? 0) + 1
    return `${counters[block.level]}.`
  })
}

function DocBlockView({ block, marker }: { block: DocBlock; marker?: string }) {
  const t = useT()
  switch (block.type) {
    case 'heading': {
      const Tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3'
      return (
        <Tag className={cn(MARKDOWN_CLASS.heading, MARKDOWN_HEADING_CLASS[block.level])}>
          <Runs runs={block.runs} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className={cn(MARKDOWN_CLASS.paragraph, 'whitespace-pre-wrap')}>
          <Runs runs={block.runs} />
        </p>
      )
    case 'listItem':
      return (
        <div
          className={cn(MARKDOWN_CLASS.listItem, 'flex gap-2 whitespace-pre-wrap')}
          style={{ paddingLeft: `${block.level * 20}px` }}
        >
          <span aria-hidden className="shrink-0 tabular-nums text-fg-3">
            {marker}
          </span>
          <span className="min-w-0">
            <Runs runs={block.runs} />
          </span>
        </div>
      )
    case 'table':
      return <Grid rows={block.rows} />
    case 'image':
      return (
        <span className="flex items-center gap-1.5 text-caption text-fg-3">
          <ImageIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
          {t('file.docx.image')}
        </span>
      )
  }
}

export function DocumentView({ preview }: { preview: DocumentPreview }) {
  const t = useT()
  const [sheet, setSheet] = useState(0)
  const markers = useMemo(() => (preview.kind === 'docx' ? listMarkers(preview.blocks) : []), [preview])
  if (preview.kind === 'docx') {
    if (!preview.blocks.length)
      return (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState compact title={t('file.emptyFile')} />
        </div>
      )
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn(MARKDOWN_CLASS.root, 'mx-auto w-full max-w-[760px] px-8 py-6')}>
          {preview.truncated ? <InlineHint kind="info">{t('file.docx.truncated')}</InlineHint> : null}
          {preview.blocks.map((block, i) => (
            <DocBlockView key={i} block={block} marker={markers[i]} />
          ))}
        </div>
      </ScrollArea>
    )
  }
  const current = preview.sheets[Math.min(sheet, preview.sheets.length - 1)]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {preview.sheets.length > 1 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line-6 px-5 py-2">
          <span className="text-caption text-fg-3">{t('file.xlsx.sheet')}</span>
          <Select
            aria-label={t('file.xlsx.sheet')}
            value={String(Math.min(sheet, preview.sheets.length - 1))}
            onValueChange={(v) => setSheet(Number(v))}
            options={preview.sheets.map((s, i) => ({ value: String(i), label: s.name || String(i + 1) }))}
          />
        </div>
      ) : null}
      {current ? (
        <TableBody rows={current.rows} truncated={current.truncated} emptyTitle={t('file.xlsx.emptySheet')} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState compact title={t('file.xlsx.emptySheet')} />
        </div>
      )}
    </div>
  )
}
