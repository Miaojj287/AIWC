/**
 * Markdown preview renderer over parse.ts for the file / diary Tabs. Every element class comes from
 * features/agent/markdownStyles.ts (the one look shared with Agent replies, CLAUDE.md §3); this surface only
 * adds layout (flex for nested blocks, tables) and opens links through the shell (app:openPath), never by
 * navigating the renderer.
 */
import { Fragment, type ReactNode } from 'react'
import { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS } from '@/features/agent/markdownStyles'
import { cn } from '@/kit'
import { openTarget } from '@/platform/openExternal'
import { parseMarkdown, type Block, type Inline } from './parse'

export interface MarkdownProps {
  source: string
  className?: string
  /** Called for [links](href); default opens externally via app:openPath. */
  onLink?(href: string): void
}

export function Markdown({ source, className, onLink }: MarkdownProps) {
  const blocks = parseMarkdown(source)
  const open = onLink ?? ((href: string) => void openTarget(href, '链接'))
  return (
    <div className={cn(MARKDOWN_CLASS.root, className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} open={open} />
      ))}
    </div>
  )
}

function BlockView({ block, open }: { block: Block; open(href: string): void }): ReactNode {
  switch (block.t) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1'
      return (
        <Tag className={cn(MARKDOWN_CLASS.heading, MARKDOWN_HEADING_CLASS[block.level])}>
          <Inlines items={block.c} open={open} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className={MARKDOWN_CLASS.paragraph}>
          <Inlines items={block.c} open={open} />
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag start={block.ordered ? block.start : undefined} className={cn(MARKDOWN_CLASS.list, block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, i) => (
            <li key={i} className={MARKDOWN_CLASS.listItem}>
              <div className="flex flex-col gap-1.5">
                {item.map((b, j) => (
                  <BlockView key={j} block={b} open={open} />
                ))}
              </div>
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre className={MARKDOWN_CLASS.codeBlock}>
          <code data-lang={block.lang}>{block.v}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote className={cn(MARKDOWN_CLASS.quote, 'flex flex-col gap-2')}>
          {block.c.map((b, i) => (
            <BlockView key={i} block={b} open={open} />
          ))}
        </blockquote>
      )
    case 'hr':
      return <hr className={MARKDOWN_CLASS.hr} />
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-caption">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} className={cn('border-b border-line-8 px-2 py-1.5 font-medium text-fg-2', alignClass(block.align[i]))}>
                    <Inlines items={cell} open={open} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-line-6 last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className={cn('select-text px-2 py-1.5 align-top', alignClass(block.align[c]))}>
                      <Inlines items={cell} open={open} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return null
  }
}

const alignClass = (a: 'left' | 'center' | 'right' | undefined) => (a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left')

function Inlines({ items, open }: { items: Inline[]; open(href: string): void }): ReactNode {
  return (
    <>
      {items.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>
          case 'strong':
            return (
              <strong key={i} className={MARKDOWN_CLASS.strong}>
                <Inlines items={n.c} open={open} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inlines items={n.c} open={open} />
              </em>
            )
          case 'code':
            return (
              <code key={i} className={MARKDOWN_CLASS.inlineCode}>
                {n.v}
              </code>
            )
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                onClick={(e) => {
                  e.preventDefault()
                  open(n.href)
                }}
                className={MARKDOWN_CLASS.link}
              >
                <Inlines items={n.c} open={open} />
              </a>
            )
          case 'br':
            return <br key={i} />
          default:
            return null
        }
      })}
    </>
  )
}
