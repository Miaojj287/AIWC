import { Copy, Ellipsis, FileDown, Sheet } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useT, type Translator } from '@/i18n'
import { cn } from '../cn'
import { IconButton } from '../IconButton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItems, DropdownMenuTrigger } from '../menu/DropdownMenu'
import type { MenuSpec } from '../menu/menuSpec'
import { toast } from '../toast/toastStore'
import { writeClipboard } from './clipboard'
import { inlineText, type MarkdownInline } from './inline'
import type { MarkdownAlign, MarkdownTable } from './parse'
import { MARKDOWN_CLASS } from './styles'
import { tableToCsv, tableToMarkdown, tableToTsv } from './tableExport'

/** What the table `···` menu offers. Without it a table has no menu. */
export interface MarkdownTableActions {
  /** 复制为 Markdown / 复制为 TSV: the kit copies and confirms with a toast. Default true. */
  copy?: boolean
  /** 另存为 CSV: receives RFC 4180 text (CRLF rows, no BOM); the caller writes the file and reports the result. */
  onSaveCsv?: (csv: string) => void
}

/** Renders one inline run; `scope` is the run it reads with (for a table cell: the whole table, row by row). */
export type MarkdownRenderInlines = (nodes: readonly MarkdownInline[], scope: readonly MarkdownInline[]) => ReactNode

const CELL_SEPARATOR: MarkdownInline = { type: 'text', text: ' | ' }
const ROW_SEPARATOR: MarkdownInline = { type: 'text', text: '\n' }

/** The table's cells in reading order with separators, the same nodes the cells render (identity matters). */
function tableScope(table: MarkdownTable): MarkdownInline[] {
  const scope: MarkdownInline[] = []
  for (const [r, cells] of [table.header, ...table.rows].entries()) {
    if (r > 0) scope.push(ROW_SEPARATOR)
    cells.forEach((cell, c) => {
      if (c > 0) scope.push(CELL_SEPARATOR)
      scope.push(...cell.children)
    })
  }
  return scope
}

const ALIGN_CLASS: Readonly<Record<NonNullable<MarkdownAlign>, string>> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

const alignClass = (align: MarkdownAlign) => (align ? ALIGN_CLASS[align] : 'text-left')

/** Rough width of one character of the 12px table text, in em: ASCII is narrow, CJK and full-width forms are 1em. */
const ASCII_EM = 0.6

/**
 * Column floors by the width of the column's longest cell (in em). Cells may break anywhere, so without a floor an
 * overflowing table would collapse every column to a character or two: short text keeps its one line, and a
 * sentence wraps at about nine characters a line — past that the table scrolls sideways instead of squeezing.
 */
const COLUMN_FLOORS: ReadonlyArray<readonly [maxEm: number, className: string]> = [
  [3.5, 'min-w-16'],
  [5, 'min-w-20'],
  [6.3, 'min-w-24'],
  [7.6, 'min-w-28'],
]
const SENTENCE_FLOOR = 'min-w-32'

function textEm(text: string): number {
  let em = 0
  for (const ch of text) em += ch.charCodeAt(0) < 0x80 ? ASCII_EM : 1
  return em
}

/** The floor class of each column; set on its header cell, which bounds the whole column. */
function columnFloors(table: MarkdownTable): string[] {
  return table.header.map((_, c) => {
    let widest = 0
    for (const row of [table.header, ...table.rows])
      widest = Math.max(widest, textEm(inlineText(row[c]?.children ?? [])))
    return COLUMN_FLOORS.find(([maxEm]) => widest <= maxEm)?.[1] ?? SENTENCE_FLOOR
  })
}

/**
 * A GFM table in its own sideways scroll box (the column around it never scrolls), header cells semibold, rows on
 * 1px lines. With `actions`, a `···` menu shows on hover / keyboard focus at the top right; the last header cell
 * keeps clear of it.
 */
export function MarkdownTableView({
  table,
  renderInlines,
  actions,
}: {
  table: MarkdownTable
  renderInlines: MarkdownRenderInlines
  actions?: MarkdownTableActions
}) {
  const scope = useMemo(() => tableScope(table), [table])
  const floors = useMemo(() => columnFloors(table), [table])
  const hasMenu = Boolean(actions && (actions.copy !== false || actions.onSaveCsv))
  const lastColumn = table.header.length - 1
  return (
    <div className={MARKDOWN_CLASS.tableWrap}>
      <div className={MARKDOWN_CLASS.tableFrame}>
        <table className={MARKDOWN_CLASS.table}>
          <thead>
            <tr className={MARKDOWN_CLASS.tableHeadRow}>
              {table.header.map((cell, c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    MARKDOWN_CLASS.tableHeader,
                    floors[c],
                    alignClass(table.align[c]),
                    hasMenu && c === lastColumn && 'pr-8',
                  )}
                >
                  {renderInlines(cell.children, scope)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((cells, r) => (
              <tr key={r} className={MARKDOWN_CLASS.tableRow}>
                {cells.map((cell, c) => (
                  <td key={c} className={cn(MARKDOWN_CLASS.tableCell, alignClass(table.align[c]))}>
                    {renderInlines(cell.children, scope)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions && hasMenu ? <TableActionsMenu table={table} actions={actions} /> : null}
    </div>
  )
}

function TableActionsMenu({ table, actions }: { table: MarkdownTable; actions: MarkdownTableActions }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const items = tableMenu(table, actions, t)
  return (
    // Ground = the frame's, so header text scrolling underneath never shows through the revealed button.
    <div
      className={cn(
        'absolute right-1 top-1 rounded-control bg-content opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100',
        open && 'opacity-100',
      )}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton size="xs" icon={Ellipsis} label={t('kit.markdown.table.actions')} className="text-fg-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItems items={items} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function tableMenu(table: MarkdownTable, actions: MarkdownTableActions, t: Translator): MenuSpec {
  const copy = async (text: string) => {
    try {
      await writeClipboard(text)
    } catch {
      toast.error(t('kit.markdown.copyFailed'))
      return
    }
    toast.success(t('kit.markdown.table.copied'))
  }
  const items: MenuSpec = []
  if (actions.copy !== false)
    items.push(
      {
        id: 'copy-markdown',
        icon: Copy,
        label: t('kit.markdown.table.copyMarkdown'),
        description: t('kit.markdown.table.copyMarkdownHint'),
        onSelect: () => void copy(tableToMarkdown(table)),
      },
      {
        id: 'copy-tsv',
        icon: Sheet,
        label: t('kit.markdown.table.copyTsv'),
        description: t('kit.markdown.table.copyTsvHint'),
        onSelect: () => void copy(tableToTsv(table)),
      },
    )
  const save = actions.onSaveCsv
  if (save)
    items.push({
      id: 'save-csv',
      icon: FileDown,
      label: t('kit.markdown.table.saveCsv'),
      description: t('kit.markdown.table.saveCsvHint'),
      onSelect: () => save(tableToCsv(table)),
    })
  return items
}
