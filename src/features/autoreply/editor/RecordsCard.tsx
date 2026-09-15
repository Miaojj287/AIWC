/**
 * 最近自动回复 card: last 10 records with hover 查看原消息 / 撤回 (2 min window, DangerDialog),
 * 查看全部 → RecordsDrawer. Live-updated by 'autoreply:record'. Figma 143:415, board 152:415 ⑤.
 *
 * Parked replies (rule sendMode 'confirm') are sent from here: the row's 确认发送 / 修改后发送 / 忽略
 * resolve the draft behind the record through autoreply:resolveDraft.
 */
import { useEffect, useState } from 'react'
import type { AutoReplyRecord } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Card, DangerDialog, EmptyState, SkeletonListRows, toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { isAwaitingConfirm, upsertRecord } from '../recordModel'
import { RecordRow, type RecordDecision } from './RecordRow'
import { RecordsDrawer } from './RecordsDrawer'

export interface RecordsCardProps {
  sessionId: string
  sessionTitle: string
  /** Controlled drawer state so the header menu can open it too. */
  drawerOpen: boolean
  onDrawerOpenChange: (open: boolean) => void
}

const RECENT_LIMIT = 10

export function RecordsCard({ sessionId, sessionTitle, drawerOpen, onDrawerOpenChange }: RecordsCardProps) {
  const t = useT()
  const loaded = useInvoke('autoreply:listRecords', { sessionId, limit: RECENT_LIMIT }, [sessionId])
  const [records, setRecords] = useState<AutoReplyRecord[]>([])
  const [recallTarget, setRecallTarget] = useState<AutoReplyRecord | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (loaded.data) setRecords(loaded.data)
  }, [loaded.data])
  useBridgeEvent('autoreply:record', (r) => {
    if (r.sessionId === sessionId) setRecords((list) => upsertRecord(list, r, RECENT_LIMIT))
  })
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const view = (r: AutoReplyRecord) =>
    runCommand('tab.openChat', {
      sessionId,
      title: sessionTitle,
      focusMessageId: r.triggerMessage.localId ?? r.triggerMessage.id,
    })

  const decide = async (r: AutoReplyRecord, decision: RecordDecision, text?: string) => {
    if (!r.draftId) return
    try {
      await invoke('autoreply:resolveDraft', { draftId: r.draftId, decision, text })
      if (decision === 'reject')
        toast.info(r.sendMode === 'auto' ? t('autoreply.records.cancelledToast') : t('autoreply.records.ignoredToast'))
      else toast.success(t('autoreply.records.sentTo', { name: sessionTitle }))
    } catch (e) {
      toast.error(decision === 'reject' ? t('common.operationFailed') : t('autoreply.records.sendFailed'), {
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }
  // Only one primary button per card: the oldest parked reply owns 确认发送.
  const primaryId = [...records].reverse().find(isAwaitingConfirm)?.id

  const recall = async () => {
    const target = recallTarget
    setRecallTarget(null)
    if (!target) return
    try {
      const res = await invoke('autoreply:recall', { recordId: target.id })
      if (res.ok) toast.success(t('autoreply.records.recalledToast'))
      else toast.error(t('autoreply.records.recallFailed'), { detail: res.error })
    } catch (e) {
      toast.error(t('autoreply.records.recallFailed'), { detail: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <>
      <Card variant="rows" className="overflow-hidden">
        {loaded.loading && records.length === 0 ? (
          <SkeletonListRows rows={3} avatar={false} className="p-4" />
        ) : loaded.error ? (
          <EmptyState
            compact
            variant="error"
            title={t('autoreply.records.loadFailed')}
            description={loaded.error.message}
            action={{ label: t('common.retry'), onClick: loaded.reload }}
          />
        ) : records.length === 0 ? (
          <EmptyState
            compact
            variant="empty"
            title={t('autoreply.records.emptyTitle')}
            description={t('autoreply.records.emptyDescription')}
          />
        ) : (
          records.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              now={now}
              onView={view}
              onRecall={setRecallTarget}
              onDecide={decide}
              primary={r.id === primaryId}
            />
          ))
        )}
      </Card>
      <RecordsDrawer
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        onView={view}
        onRecall={setRecallTarget}
        onDecide={decide}
      />
      <DangerDialog
        open={recallTarget !== null}
        onOpenChange={(o) => !o && setRecallTarget(null)}
        title={t('autoreply.records.recallTitle')}
        description={t('autoreply.records.recallDescription')}
        confirmLabel={t('autoreply.records.recall')}
        onConfirm={recall}
      >
        {recallTarget ? (
          <div className="rounded-item border border-line-8 bg-content px-3 py-2 text-caption text-fg-2">
            {recallTarget.replyText}
          </div>
        ) : null}
      </DangerDialog>
    </>
  )
}

export function ViewAllLink({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Button variant="link" size="sm" onClick={onClick}>
      {t('autoreply.records.viewAll')}
    </Button>
  )
}
