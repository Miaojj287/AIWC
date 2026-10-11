/**
 * Markdown — the one renderer for Agent replies and Markdown files (CLAUDE.md §3): parse.ts / inline.ts produce
 * data, this file turns it into React elements, so no HTML from the source ever reaches the DOM. Every element
 * class comes from styles.ts. Surfaces adjust it through props, never by forking it:
 *   preserveLineBreaks — single newlines stay visible (Agent replies); off = standard Markdown (a space)
 *   onLink             — link clicks; without it links are inert text with the target in `title`
 *   renderInlines      — replaces the inline renderer of every run (paragraphs, headings, list items, quotes and
 *                        table cells), e.g. the Agent's evidence-citation chips
 *   tableActions       — the table `···` menu (copy as Markdown / TSV, save as CSV)
 *   resolveImage       — ![alt](src) as a zoomable image: maps the source to a URL the page may load (undefined
 *                        keeps it a link); without it images stay links labelled with their alt text
 * ```mermaid blocks are drawn as diagrams (MermaidBlock.tsx, loaded on first use).
 */
import { Fragment, useMemo, type ReactNode } from 'react'
import { cn } from '../cn'
import { MarkdownCodeBlock } from './CodeBlock'
import { inlineText } from './inline'
import { MarkdownImage } from './MarkdownImage'
import { MermaidBlock } from './MermaidBlock'
import type { MarkdownInline } from './inline'
import { MarkdownTableView, type MarkdownRenderInlines, type MarkdownTableActions } from './MarkdownTable'
import { parseMarkdown, type MarkdownBlock } from './parse'
import { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS } from './styles'

export interface MarkdownProps {
  source: string
  className?: string
  /** Show single newlines inside a paragraph as line breaks (chat replies) instead of collapsing them to a space. */
  preserveLineBreaks?: boolean
  /** Called for a link click with the default inline renderer. */
  onLink?: (href: string) => void
  /** Replaces the default inline renderer; `scope` is the run the nodes read with (a table cell: the whole table). */
  renderInlines?: MarkdownRenderInlines
  /** Offer the table `···` menu; omit for none. */
  tableActions?: MarkdownTableActions
  /** Show ![alt](src) as an image: the URL to load for a source, or undefined to keep it a link. */
  resolveImage?: (src: string) => string | undefined
}

interface RenderContext {
  inlines: MarkdownRenderInlines
  preserveLineBreaks: boolean
  tableActions?: MarkdownTableActions
}

export function Markdown({
  source,
  className,
  preserveLineBreaks = false,
  onLink,
  renderInlines,
  tableActions,
  resolveImage,
}: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  const ctx = useMemo<RenderContext>(
    () => ({
      inlines:
        renderInlines ?? ((nodes) => <MarkdownInlines nodes={nodes} onLink={onLink} resolveImage={resolveImage} />),
      preserveLineBreaks,
      tableActions,
    }),
    [renderInlines, onLink, preserveLineBreaks, tableActions, resolveImage],
  )
  return (
    <div className={cn(MARKDOWN_CLASS.root, className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} ctx={ctx} />
      ))}
    </div>
  )
}

function BlockView({ block, ctx }: { block: MarkdownBlock; ctx: RenderContext }): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as const
      return (
        <Tag className={cn(MARKDOWN_CLASS.heading, MARKDOWN_HEADING_CLASS[block.level])}>
          {ctx.inlines(block.children, block.children)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className={cn(MARKDOWN_CLASS.paragraph, ctx.preserveLineBreaks && 'whitespace-pre-wrap')}>
          {ctx.inlines(block.children, block.children)}
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          start={block.ordered ? block.start : undefined}
          className={cn(MARKDOWN_CLASS.list, block.ordered ? 'list-decimal' : 'list-disc')}
        >
          {block.items.map((item, i) => (
            <ListItemView key={i} blocks={item} ctx={ctx} />
          ))}
        </Tag>
      )
    }
    case 'code':
      return block.lang?.toLowerCase() === 'mermaid' ? (
        <MermaidBlock code={block.code} />
      ) : (
        <MarkdownCodeBlock lang={block.lang} code={block.code} />
      )
    case 'quote':
      return (
        <blockquote className={cn(MARKDOWN_CLASS.quote, 'flex flex-col gap-2')}>
          {block.children.map((child, i) => (
            <BlockView key={i} block={child} ctx={ctx} />
          ))}
        </blockquote>
      )
    case 'rule':
      return <hr className={MARKDOWN_CLASS.hr} />
    case 'table':
      return <MarkdownTableView table={block} renderInlines={ctx.inlines} actions={ctx.tableActions} />
  }
}

/** A one-paragraph item renders its text straight in the <li>; anything indented under it stacks below. */
function ListItemView({ blocks, ctx }: { blocks: MarkdownBlock[]; ctx: RenderContext }) {
  const [only] = blocks
  if (blocks.length === 1 && only?.type === 'paragraph')
    return (
      <li className={cn(MARKDOWN_CLASS.listItem, ctx.preserveLineBreaks && 'whitespace-pre-wrap')}>
        {ctx.inlines(only.children, only.children)}
      </li>
    )
  return (
    <li className={MARKDOWN_CLASS.listItem}>
      <div className="flex flex-col gap-1.5">
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} ctx={ctx} />
        ))}
      </div>
    </li>
  )
}

export interface MarkdownInlinesProps {
  nodes: readonly MarkdownInline[]
  /** Link clicks; without it a link is inert text with its target in `title` (the Agent panel never navigates). */
  onLink?: (href: string) => void
  /** Replaces one node at any depth (e.g. a citation chip); return `undefined` to keep the default rendering. */
  renderNode?: (node: MarkdownInline, key: number) => ReactNode
  /** Show images (see MarkdownProps.resolveImage). */
  resolveImage?: (src: string) => string | undefined
}

/** The default inline renderer, with the shared element classes. */
export function MarkdownInlines({ nodes, onLink, renderNode, resolveImage }: MarkdownInlinesProps) {
  return (
    <>
      {nodes.map((node, i) => {
        const custom = renderNode?.(node, i)
        return custom === undefined ? renderInline(node, i, { onLink, renderNode, resolveImage }) : custom
      })}
    </>
  )
}

function renderInline(
  node: MarkdownInline,
  key: number,
  opts: Pick<MarkdownInlinesProps, 'onLink' | 'renderNode' | 'resolveImage'>,
): ReactNode {
  const { onLink } = opts
  const children = (nodes: readonly MarkdownInline[]) => <MarkdownInlines nodes={nodes} {...opts} />
  switch (node.type) {
    case 'text':
      return <Fragment key={key}>{node.text}</Fragment>
    case 'strong':
      return (
        <strong key={key} className={MARKDOWN_CLASS.strong}>
          {children(node.children)}
        </strong>
      )
    case 'em':
      return <em key={key}>{children(node.children)}</em>
    case 'code':
      return (
        <code key={key} className={MARKDOWN_CLASS.inlineCode}>
          {node.text}
        </code>
      )
    case 'link': {
      const image = node.image ? opts.resolveImage?.(node.href) : undefined
      if (image) return <MarkdownImage key={key} src={image} alt={inlineText(node.children)} />
      return onLink ? (
        <a
          key={key}
          href={node.href}
          onClick={(e) => {
            e.preventDefault()
            onLink(node.href)
          }}
          className={MARKDOWN_CLASS.link}
        >
          {children(node.children)}
        </a>
      ) : (
        <span key={key} title={node.href} className={MARKDOWN_CLASS.link}>
          {children(node.children)}
        </span>
      )
    }
    case 'break':
      return <br key={key} />
  }
}
