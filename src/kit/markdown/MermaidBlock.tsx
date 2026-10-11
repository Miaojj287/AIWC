/**
 * A ```mermaid fenced block drawn as a diagram (mermaidLoader.ts: lazy, strict, themed from the tokens). While the
 * source is still arriving (a streaming reply) or cannot be drawn, the block shows its source like any code block,
 * with one line saying the diagram could not be drawn; 查看源码 / 查看图表 switches between the two, and 放大查看
 * opens the diagram in a zoomable dialog. The diagram is redrawn when the theme changes.
 */
import { Code2, Maximize2, Network } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { cn } from '../cn'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../Dialog'
import { IconButton } from '../IconButton'
import { Spinner } from '../Spinner'
import { Tooltip } from '../Tooltip'
import { ZoomPan } from '../ZoomPan'
import { MarkdownCodeBlock } from './CodeBlock'
import { renderMermaid } from './mermaidLoader'

/** Wait this long after the source last changed before drawing (a streaming reply grows token by token). */
const RENDER_DEBOUNCE_MS = 300

type DrawState = { status: 'drawing' } | { status: 'ready'; svg: string } | { status: 'failed' }

/** Changes whenever the theme or palette does (html attributes / inline style, the system scheme). */
function useThemeSignature(): number {
  const [signature, setSignature] = useState(0)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const bump = () => setSignature((n) => n + 1)
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
    scheme?.addEventListener?.('change', bump)
    return () => {
      observer.disconnect()
      scheme?.removeEventListener?.('change', bump)
    }
  }, [])
  return signature
}

/** Puts a sanitised SVG string into the page through the DOM parser (never as HTML). */
function SvgView({ svg, className }: { svg: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const node = document.importNode(doc.documentElement, true)
    host.replaceChildren(node)
    return () => host.replaceChildren()
  }, [svg])
  return <div ref={ref} className={cn('[&>svg]:h-auto [&>svg]:max-w-full', className)} />
}

export function MermaidBlock({ code }: { code: string }) {
  const t = useT()
  const theme = useThemeSignature()
  const [state, setState] = useState<DrawState>({ status: 'drawing' })
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState((s) => (s.status === 'ready' ? s : { status: 'drawing' }))
    const timer = setTimeout(() => {
      renderMermaid(code).then(
        (svg) => !cancelled && setState({ status: 'ready', svg }),
        // Not a diagram mermaid can draw (or not finished yet): the source stands in for it.
        () => !cancelled && setState({ status: 'failed' }),
      )
    }, RENDER_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, theme])

  const ready = state.status === 'ready' ? state : undefined
  const source = !ready || showSource
  return (
    <figure
      className="group/mermaid relative m-0 flex min-w-0 flex-col gap-1"
      aria-label={t('kit.markdown.mermaid.label')}
    >
      {source ? (
        <MarkdownCodeBlock lang="mermaid" code={code} />
      ) : (
        <div className="overflow-x-auto rounded-item border border-line-6 bg-content p-3">
          <SvgView svg={ready.svg} className="flex justify-center" />
        </div>
      )}
      <figcaption className="flex min-h-6 items-center gap-1 text-caption text-fg-3">
        {state.status === 'drawing' ? (
          <>
            <Spinner size={12} />
            <span className="min-w-0 truncate">{t('kit.markdown.mermaid.rendering')}</span>
          </>
        ) : state.status === 'failed' ? (
          <span className="min-w-0 truncate">{t('kit.markdown.mermaid.failed')}</span>
        ) : (
          <>
            <Tooltip content={t(showSource ? 'kit.markdown.mermaid.showDiagram' : 'kit.markdown.mermaid.showSource')}>
              <IconButton
                size="xs"
                icon={showSource ? Network : Code2}
                label={t(showSource ? 'kit.markdown.mermaid.showDiagram' : 'kit.markdown.mermaid.showSource')}
                onClick={() => setShowSource(!showSource)}
                className="text-fg-3"
              />
            </Tooltip>
            {showSource ? null : (
              <Tooltip content={t('kit.markdown.mermaid.expand')}>
                <IconButton
                  size="xs"
                  icon={Maximize2}
                  label={t('kit.markdown.mermaid.expand')}
                  onClick={() => setExpanded(true)}
                  className="text-fg-3"
                />
              </Tooltip>
            )}
          </>
        )}
      </figcaption>
      {ready ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent size="xl" className="h-[min(80vh,900px)] w-[min(92vw,1200px)] max-w-none p-3">
            <DialogTitle className="sr-only">{t('kit.markdown.mermaid.label')}</DialogTitle>
            <DialogDescription className="sr-only">{t('kit.zoomPan.roleDescription')}</DialogDescription>
            <ZoomPan label={t('kit.markdown.mermaid.label')} className="h-full w-full rounded-item bg-content">
              <SvgView svg={ready.svg} />
            </ZoomPan>
          </DialogContent>
        </Dialog>
      ) : null}
    </figure>
  )
}
