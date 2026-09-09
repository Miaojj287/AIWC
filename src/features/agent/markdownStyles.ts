/**
 * The one look for rendered Markdown (CLAUDE.md §3 「同一种东西只有一种长相」).
 *
 * Agent replies (features/agent/MarkdownView) and generated .md files / diaries (features/file/markdown)
 * are the same thing seen on two surfaces, so every element class lives here and both renderers compose
 * from it. Surfaces may add layout-only classes (min-w-0, whitespace handling, flex for nested blocks)
 * but never a second radius, border strength, or type size for the same element.
 *
 * Type scale follows CLAUDE.md §2.3 and stays on the token ladder (20 / 14 / 13 / 12): h1 = page title
 * 20, h2 = bubble 14, h3–h4 = body 13, h5–h6 = caption 12, weaker levels step down in colour instead
 * of size. Small radius is the single allowed 4px (`rounded-sm`); the blockquote bar is the kit's
 * `line-25` step; code frames / inline code are `line-8` on the content ground.
 */
export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export const MARKDOWN_HEADING_CLASS: Readonly<Record<MarkdownHeadingLevel, string>> = {
  1: 'text-title leading-7 mt-2',
  2: 'text-bubble leading-6 mt-4',
  3: 'text-body leading-5 mt-3',
  4: 'text-body leading-5 mt-2 text-fg-2',
  5: 'text-caption leading-4 mt-2 text-fg-2',
  6: 'text-caption leading-4 mt-2 text-fg-3',
}

export const MARKDOWN_CLASS = {
  /** Root container: block gap + body type. */
  root: 'flex flex-col gap-2.5 text-body leading-[22px] text-fg',
  /** Base for every heading; combine with MARKDOWN_HEADING_CLASS[level]. */
  heading: 'font-medium text-fg',
  paragraph: 'select-text',
  /** <ul> / <ol>; combine with `list-disc` or `list-decimal`. */
  list: 'flex flex-col gap-1 pl-5 marker:text-fg-3',
  listItem: 'select-text',
  /** Fenced code <pre>: frame on the content ground + caption-size mono. Surfaces overlay chrome (复制) on a relative wrapper. */
  codeBlock: 'select-text overflow-x-auto rounded-item border border-line-8 bg-content px-3 py-2.5 font-mono text-caption leading-[18px] text-fg-2',
  inlineCode: 'rounded-sm bg-line-8 px-1 py-px font-mono text-caption text-fg',
  quote: 'border-l-2 border-(--line-25) pl-3 text-fg-2',
  hr: 'my-1 border-0 border-t border-line-8',
  strong: 'font-medium text-fg',
  link: 'text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent',
} as const

export type MarkdownClassKey = keyof typeof MARKDOWN_CLASS
