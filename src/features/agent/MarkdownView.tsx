/**
 * Agent replies through the kit Markdown renderer: one parser and one look with the file preview (CLAUDE.md §3).
 * This wrapper adds only what the Agent needs: soft line breaks stay visible, a `wx://` link becomes a CitationChip
 * that checks the quotes its block pairs with it (table cells included), a table can be saved as CSV, and a local
 * image (![alt](/path/chart.png)) shows and opens in the zoomable viewer.
 */
import { memo, useCallback, type ReactNode } from 'react'
import {
  inlineText,
  Markdown as KitMarkdown,
  MarkdownInlines,
  type MarkdownInline,
  type MarkdownRenderInlines,
  type MarkdownTableActions,
} from '@/kit'
import { toMediaUrl } from '@/platform/mediaUrl'
import { parseCitation, planCitations, type CitationClaim, type CitationToken } from './citations'
import { CitationChip } from './CitationChip'
import { saveTableCsv } from './saveTableCsv'

export interface MarkdownProps {
  text: string
  className?: string
}

export const Markdown = memo(function Markdown({ text, className }: MarkdownProps) {
  return (
    <KitMarkdown
      source={text}
      className={className}
      preserveLineBreaks
      renderInlines={renderCitationInlines}
      tableActions={TABLE_ACTIONS}
    />
  )
})

const TABLE_ACTIONS: MarkdownTableActions = { onSaveCsv: (csv) => void saveTableCsv(csv) }

type CitationPlan = ReadonlyMap<MarkdownInline, CitationClaim>

/** One plan per scope (a block's run, or a whole table): every cell of a table shares its table's plan. */
const plans = new WeakMap<readonly MarkdownInline[], CitationPlan>()

/**
 * Pairs a block's quotes with its `wx://` links the way the host's audit does (@aiwc/protocol planCitations), so a
 * chip checks exactly the quotes written for it. Bold / italic runs are part of the same block; a table is one
 * block, as the audit reads it, so a quote in one cell vouches for a citation in the next.
 */
function planFor(scope: readonly MarkdownInline[]): CitationPlan {
  const cached = plans.get(scope)
  if (cached) return cached
  const tokens: CitationToken[] = []
  const links: MarkdownInline[] = []
  const walk = (list: readonly MarkdownInline[]) => {
    for (const n of list) {
      const ref = n.type === 'link' ? parseCitation(n.href) : undefined
      if (n.type === 'link' && ref) {
        tokens.push({ kind: 'cite', label: inlineText(n.children), link: n.href, ...ref })
        links.push(n)
      } else if (n.type === 'strong' || n.type === 'em') walk(n.children)
      else tokens.push({ kind: 'text', text: inlineText([n]) })
    }
  }
  walk(scope)
  const claims = planCitations(tokens)
  const plan = new Map(links.flatMap((n, i) => (claims[i] ? [[n, claims[i]] as const] : [])))
  plans.set(scope, plan)
  return plan
}

const NO_QUOTES: readonly string[] = []
const NO_RUN: readonly CitationClaim['run'][number][] = []

const renderCitationInlines: MarkdownRenderInlines = (nodes, scope) => <CitationInlines nodes={nodes} scope={scope} />

/** The kit's inline run, with every `wx://` link (at any depth) as a CitationChip. Other links stay inert text. */
function CitationInlines({ nodes, scope }: { nodes: readonly MarkdownInline[]; scope: readonly MarkdownInline[] }) {
  const renderNode = useCallback(
    (node: MarkdownInline, key: number): ReactNode => {
      const ref = node.type === 'link' ? parseCitation(node.href) : undefined
      if (node.type !== 'link' || !ref) return undefined
      const claim = planFor(scope).get(node)
      return (
        <CitationChip
          key={key}
          sessionId={ref.sessionId}
          messageId={ref.messageId}
          label={inlineText(node.children)}
          quotes={claim?.quotes ?? NO_QUOTES}
          run={claim?.run ?? NO_RUN}
        />
      )
    },
    [scope],
  )
  return <MarkdownInlines nodes={nodes} renderNode={renderNode} resolveImage={resolveReplyImage} />
}

/** Local files the reply points at (a generated chart, a decrypted chat image); remote images stay links. */
const LOCAL_IMAGE = /^(data:image\/|aiwc-media:|\/|[a-zA-Z]:[\\/])/

/**
 * An image in a reply: local paths and data URLs load through the media protocol (its allow-list decides what may
 * be served); a remote URL is never fetched (nothing leaves the machine because a reply mentioned it).
 */
export function resolveReplyImage(src: string): string | undefined {
  return LOCAL_IMAGE.test(src.trim()) ? toMediaUrl(src.trim()) : undefined
}
