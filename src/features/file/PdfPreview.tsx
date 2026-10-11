/**
 * PDF preview for the file Tab: pdf.js (loaded on first use) draws each page onto a canvas when it scrolls
 * near the viewport; pages far away stay as sized placeholders, so a long PDF opens at once. Fit-to-width
 * by default, with zoom out / in. Text is not selectable (canvas only) — 用默认应用打开 covers that.
 */
import { Minus, Plus, ScanLine } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, EmptyState, IconButton, ScrollArea } from '@/kit'
import { useT } from '@/i18n'
import type { PDFDocumentProxy } from './pdfDocument'

/** Pages rendered at most (a scanned book still opens; the rest is behind 用默认应用打开). */
const MAX_PAGES = 500
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 3
/** Horizontal room around the page in fit mode (px). */
const FIT_GUTTER = 48
/** Start rendering a page this far before it scrolls into view. */
const PRERENDER_MARGIN = '800px'
/** Assumed page size (A4 portrait at 72 dpi) until the first page has been measured. */
const DEFAULT_PAGE = { width: 595, height: 842 }

type Zoom = 'fit' | number

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PdfPreview({ data }: { data: Uint8Array }) {
  const t = useT()
  const [doc, setDoc] = useState<PDFDocumentProxy | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [width, setWidth] = useState(0)
  const [base, setBase] = useState(DEFAULT_PAGE)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let cancel: (() => void) | undefined
    let opened: PDFDocumentProxy | undefined
    import('./pdfDocument')
      .then(async ({ openPdf }) => {
        if (cancelled) return
        const task = openPdf(data)
        cancel = task.cancel
        const d = await task.promise
        if (cancelled) {
          void d.destroy()
          return
        }
        opened = d
        const first = (await d.getPage(1)).getViewport({ scale: 1 })
        if (!cancelled) {
          setBase({ width: first.width, height: first.height })
          setDoc(d)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e))
      })
    return () => {
      cancelled = true
      cancel?.()
      void opened?.destroy()
    }
  }, [data])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  const fitScale = width > FIT_GUTTER ? (width - FIT_GUTTER) / base.width : 1
  const scale = zoom === 'fit' ? fitScale : zoom
  const step = (dir: 1 | -1) => {
    const next =
      dir > 0 ? ZOOM_STEPS.find((z) => z > scale + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.01)
    if (next !== undefined) setZoom(next)
  }
  const pages = doc ? Math.min(doc.numPages, MAX_PAGES) : 0

  if (error)
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState variant="error" title={t('file.pdf.failed')} description={error} />
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-6 px-4">
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3">
          {doc
            ? doc.numPages > MAX_PAGES
              ? t('file.pdf.pagesCapped', { n: doc.numPages, shown: MAX_PAGES })
              : t('file.pdf.pages', { n: doc.numPages })
            : t('file.loading')}
        </span>
        <IconButton
          icon={Minus}
          size="sm"
          label={t('file.zoom.out')}
          disabled={!doc || scale <= MIN_ZOOM + 0.01}
          disabledReason={t('file.zoom.min')}
          onClick={() => step(-1)}
        />
        <span className="w-11 text-center font-latin text-micro tabular-nums text-fg-2">
          {Math.round(scale * 100)}%
        </span>
        <IconButton
          icon={Plus}
          size="sm"
          label={t('file.zoom.in')}
          disabled={!doc || scale >= MAX_ZOOM - 0.01}
          disabledReason={t('file.zoom.max')}
          onClick={() => step(1)}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={ScanLine}
          disabled={zoom === 'fit'}
          disabledReason={t('file.zoom.isFit')}
          onClick={() => setZoom('fit')}
        >
          {t('file.zoom.fit')}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 bg-shell" orientation="both" viewportRef={viewportRef}>
        {doc ? (
          <div className="flex flex-col items-center gap-4 px-6 py-6">
            {Array.from({ length: pages }, (_, i) => (
              <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} scale={scale} estimate={base} />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center py-16">
            <EmptyState variant="loading" title={t('file.loading')} />
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  estimate,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  estimate: { width: number; height: number }
}) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState(estimate)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: PRERENDER_MARGIN },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let cancelRender: (() => void) | undefined
    void doc
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const unscaled = page.getViewport({ scale: 1 })
        setSize({ width: unscaled.width, height: unscaled.height })
        const canvas = canvasRef.current
        if (!canvas) return
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        const task = page.render({
          canvas,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        })
        cancelRender = () => task.cancel()
        await task.promise
      })
      .catch((e: unknown) => {
        // A render superseded by a zoom change is cancelled on purpose.
        if (!cancelled && (e as { name?: string } | undefined)?.name !== 'RenderingCancelledException') setFailed(true)
      })
    return () => {
      cancelled = true
      cancelRender?.()
    }
  }, [doc, pageNumber, scale, visible])

  const w = Math.round(size.width * scale)
  const h = Math.round(size.height * scale)
  return (
    <div
      ref={boxRef}
      className="relative shrink-0 overflow-hidden rounded-item border border-line-8 bg-white"
      style={{ width: w, height: h }}
      aria-label={t('file.pdf.page', { n: pageNumber })}
      role="img"
    >
      {failed ? (
        <div className="flex size-full items-center justify-center">
          <EmptyState compact variant="error" title={t('file.pdf.pageFailed', { n: pageNumber })} />
        </div>
      ) : (
        <canvas ref={canvasRef} className="block size-full" />
      )}
    </div>
  )
}
