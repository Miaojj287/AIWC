/**
 * 查看全部 → right Drawer with the full record list, 今天 / 本周 / 全部 chips and a status filter
 * (board 152:415 ⑤). Live-updated through 'autoreply:record'.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AutoReplyRecord, ReplyRecordStatus } from '@aiwc/protocol'
import { useT, type Translator } from '@/i18n'
import { Chip, Drawer, EmptyState, Select, SkeletonListRows, type SelectOption } from '@/kit'
import { useBridgeEvent, useInvoke } from '@/platform/hooks'
import { RECORD_RANGES, RECORD_STATUS, filterRecords, upsertRecord, type RecordRange } from '../recordModel'
import { RecordRow, type RecordDecision } from './RecordRow'

export interface RecordsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  sessionTitle: string
  onView: (record: AutoReplyRecord) => void
  onRecall: (record: AutoReplyRecord) => void
  onDecide?: (record: AutoReplyRecord, decision: RecordDecision, text?: string) => Promise<void>
}

const statusOptions = (t: Translator): SelectOption<ReplyRecordStatus | 'all'>[] => [
  { value: 'all', label: t('autoreply.records.allStatuses') },
  ...(Object.keys(RECORD_STATUS) as ReplyRecordStatus[]).map((s) => ({
    value: s,
    label: t(RECORD_STATUS[s].labelKey),
  })),
]

export function RecordsDrawer({
  open,
  onOpenChange,
  sessionId,
  sessionTitle,
  onView,
  onRecall,
  onDecide,
}: RecordsDrawerProps) {
  const t = useT()
  const loaded = useInvoke('autoreply:listRecords', { sessionId, limit: 500 }, [sessionId, open], { enabled: open })
  const [records, setRecords] = useState<AutoReplyRecord[]>([])
  const [range, setRange] = useState<RecordRange>('today')
  const [status, setStatus] = useState<ReplyRecordStatus | 'all'>('all')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (loaded.data) setRecords(loaded.data)
  }, [loaded.data])
  useBridgeEvent('autoreply:record', (r) => {
    if (r.sessionId === sessionId) setRecords((list) => upsertRecord(list, r))
  })
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [open])

  const visible = useMemo(() => filterRecords(records, range, now, status), [records, range, now, status])
  const options = useMemo(() => statusOptions(t), [t])

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('autoreply.records.drawerTitle', { name: sessionTitle })}
      actions={
        <Select<ReplyRecordStatus | 'all'>
          aria-label={t('autoreply.records.statusFilter')}
          options={options}
          value={status}
          onValueChange={setStatus}
          align="end"
          className="h-6"
        />
      }
      className="w-[400px]"
    >
      <div className="mb-2 flex items-center gap-1.5">
        {RECORD_RANGES.map((r) => (
          <Chip key={r.value} label={t(r.labelKey)} selected={range === r.value} onClick={() => setRange(r.value)} />
        ))}
        <span className="ml-auto font-latin text-micro text-fg-3">
          {t('autoreply.records.count', { n: visible.length })}
        </span>
      </div>
      {loaded.loading && records.length === 0 ? (
        <SkeletonListRows rows={5} avatar={false} />
      ) : loaded.error ? (
        <EmptyState
          compact
          variant="error"
          title={t('autoreply.records.loadFailed')}
          description={loaded.error.message}
          action={{ label: t('common.retry'), onClick: loaded.reload }}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          variant={records.length === 0 ? 'empty' : 'no-results'}
          title={records.length === 0 ? t('autoreply.records.emptyTitle') : t('autoreply.records.noneInRange')}
          description={
            records.length === 0 ? t('autoreply.records.drawerEmptyDescription') : t('autoreply.records.tryOtherFilter')
          }
        />
      ) : (
        <div className="-mx-3 flex flex-col">
          {visible.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              now={now}
              onView={onView}
              onRecall={onRecall}
              onDecide={onDecide}
              compact
            />
          ))}
        </div>
      )}
    </Drawer>
  )
}
