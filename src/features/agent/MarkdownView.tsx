/**
 * Renders the markdownParser.ts AST for Agent replies. Every element class comes from markdownStyles.ts
 * (shared with the file / diary Markdown preview, CLAUDE.md §3); this surface only adds layout: min-w-0 so
 * code can scroll inside the 360 column, pre-wrap so soft breaks in a reply stay visible, and a hover 复制
 * button over fenced code (CLAUDE.md §4.1).
 */
import { Check, Copy } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { cn, IconButton } from '@/kit'
import { parseMarkdown, type Block, type Inline } from './markdownParser'
import { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS } from './markdownStyles'

export interface MarkdownProps {
  text: string
  className?: string
  /** Called after a fenced block was copied (the panel shows a toast). */
  onCopied?: () => void
}

export const Markdown = memo(function Markdown({ text, className, onCopied }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className={cn(MARKDOWN_CLASS.root, 'min-w-0 break-words', className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} onCopied={onCopied} />
      ))}
    </div>
  )
})

function BlockView({ block, onCopied }: { block: Block; onCopied?: () => void }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag className={cn(MARKDOWN_CLASS.heading, MARKDOWN_HEADING_CLASS[block.level])}>
          <Inlines nodes={block.children} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className={cn(MARKDOWN_CLASS.paragraph, 'whitespace-pre-wrap')}>
          <Inlines nodes={block.children} />
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag start={block.ordered ? block.start : undefined} className={cn(MARKDOWN_CLASS.list, block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, i) => (
            <li key={i} className={MARKDOWN_CLASS.listItem}>
              <Inlines nodes={item} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return <CodeBlock lang={block.lang} code={block.code} onCopied={onCopied} />
    case 'quote':
      return (
        <blockquote className={cn(MARKDOWN_CLASS.quote, 'whitespace-pre-wrap')}>
          <Inlines nodes={block.children} />
        </blockquote>
      )
    case 'rule':
      return <hr className={MARKDOWN_CLASS.hr} />
  }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((n, i) => renderInline(n, i))}</>
}

function renderInline(node: Inline, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text
    case 'bold':
      return (
        <strong key={key} className={MARKDOWN_CLASS.strong}>
          <Inlines nodes={node.children} />
        </strong>
      )
    case 'italic':
      return (
        <em key={key}>
          <Inlines nodes={node.children} />
        </em>
      )
    case 'code':
      return (
        <code key={key} className={MARKDOWN_CLASS.inlineCode}>
          {node.text}
        </code>
      )
    case 'link':
      // No navigation from the panel: links stay visible as text with the target in the title.
      return (
        <span key={key} title={node.href} className={MARKDOWN_CLASS.link}>
          {node.text}
        </span>
      )
  }
}

function CodeBlock({ lang, code, onCopied }: { lang?: string; code: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code)
      setCopied(true)
      onCopied?.()
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="group/code relative min-w-0">
      <pre className={MARKDOWN_CLASS.codeBlock}>
        <code data-lang={lang}>{code}</code>
      </pre>
      <IconButton
        size="xs"
        icon={copied ? Check : Copy}
        label={copied ? '已复制' : '复制代码'}
        onClick={() => void copy()}
        className={cn('absolute right-1 top-1 text-fg-3 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100', copied && 'opacity-100 text-ok')}
      />
    </div>
  )
}
