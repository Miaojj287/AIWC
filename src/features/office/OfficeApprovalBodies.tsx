/**
 * What the 二次确认 shows for office tools, in place of raw input JSON: the table that is about to leave
 * the machine (columns, first rows, counts), the exact CLI command, or the steps a connect will take.
 * The user approves what they can read (CLAUDE.md §4.4, §6).
 */
import type { OfficePlatform } from '@aiwc/protocol'
import { isOfficePlatform } from '@aiwc/protocol'
import type { ApprovalBodyProps } from '@/features/agent/toolCards'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/kit'

const PREVIEW_ROWS = 5
const PREVIEW_COLUMNS = 8

const STEPS: Record<OfficePlatform, MessageKey[]> = {
  feishu: ['office.step.install', 'office.step.app', 'office.step.authorize', 'office.step.verify'],
  dingtalk: ['office.step.install', 'office.step.authorize', 'office.step.verify'],
  wecom: ['office.step.install', 'office.step.authorizeWecom', 'office.step.verify'],
}

type Json = Record<string, unknown>
const record = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined

function cellText(value: unknown, separator: string): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(String).join(separator)
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return String(value)
}

function FallbackJson({ value }: { value: unknown }) {
  return (
    <pre className="m-0 max-h-[132px] overflow-auto rounded-control border border-line-6 bg-content px-2.5 py-2 font-mono text-micro leading-4 text-fg-3 select-text">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function PushTableApproval({ request }: ApprovalBodyProps) {
  const t = useT()
  const input = record(request.input)
  const columns = Array.isArray(input?.columns)
    ? (input.columns as unknown[]).map(record).filter((c): c is Json => typeof c?.name === 'string')
    : []
  const rows = Array.isArray(input?.rows)
    ? (input.rows as unknown[]).map(record).filter((r): r is Json => Boolean(r))
    : []
  if (columns.length === 0) return <FallbackJson value={request.input} />
  const shownColumns = columns.slice(0, PREVIEW_COLUMNS)
  const shownRows = rows.slice(0, PREVIEW_ROWS)
  const target = record(input?.target)
  const separator = t('office.approval.listSeparator')
  return (
    <div className="flex flex-col gap-1.5" data-testid="office-push-approval">
      <div className="flex flex-wrap items-center gap-x-2 text-micro text-fg-3">
        <span>{t('office.approval.tableMeta', { rows: rows.length, columns: columns.length })}</span>
        {target ? <span className="text-accent">{t('office.approval.appendTo')}</span> : null}
        {typeof target?.url === 'string' ? (
          <span className="min-w-0 truncate font-mono" title={target.url}>
            {target.url}
          </span>
        ) : null}
      </div>
      <div className="max-h-[172px] overflow-auto rounded-control border border-line-6 bg-content select-text">
        <table className="w-full border-collapse text-micro leading-4">
          <thead>
            <tr>
              {shownColumns.map((c) => (
                <th
                  key={String(c.name)}
                  scope="col"
                  className="sticky top-0 whitespace-nowrap border-b border-line-6 bg-panel px-2 py-1 text-left font-medium text-fg-2"
                >
                  {String(c.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row, i) => (
              <tr key={i} className="border-b border-line-6 last:border-b-0">
                {shownColumns.map((c, j) => (
                  <td
                    key={j}
                    className={cn('max-w-[160px] truncate px-2 py-1', j === 0 ? 'text-fg' : 'text-fg-2')}
                    title={cellText(row[String(c.name)], separator)}
                  >
                    {cellText(row[String(c.name)], separator)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shownRows.length || columns.length > shownColumns.length ? (
        <span className="text-micro text-fg-3">
          {[
            rows.length > shownRows.length
              ? t('office.approval.moreRows', { n: rows.length - shownRows.length })
              : null,
            columns.length > shownColumns.length
              ? t('office.approval.moreColumns', { n: columns.length - shownColumns.length })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : null}
    </div>
  )
}



export function ConnectApproval({ request }: ApprovalBodyProps) {
  const t = useT()
  const platform = record(request.input)?.platform
  if (!isOfficePlatform(platform)) return <FallbackJson value={request.input} />
  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 rounded-control border border-line-6 bg-content px-2.5 py-2">
      {STEPS[platform].map((key, i) => (
        <li key={key} className="flex items-center gap-2 text-caption leading-[18px] text-fg-2">
          <span className="font-latin text-micro text-fg-3">{i + 1}</span>
          {t(key)}
        </li>
      ))}
    </ol>
  )
}
