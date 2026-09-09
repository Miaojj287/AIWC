/**
 * 最近自动回复 card: last 10 records with hover 查看原消息 / 撤回 (2 min window, DangerDialog),
 * 查看全部 → RecordsDrawer. Live-updated by 'autoreply:record'. Figma 143:415, board 152:415 ⑤.
 */
import { useEffect, useState } from 'react'
import type { AutoReplyRecord } from '@aiwc/protocol'
import { Button, Card, DangerDialog, EmptyState, SkeletonListRows, toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { upsertRecord } from '../recordModel'
import { RecordRow } from './RecordRow'
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

  const view = (r: AutoReplyRecord) => runCommand('tab.openChat', { sessionId, title: sessionTitle, focusMessageId: r.triggerMessage.id })

  const recall = async () => {
    const target = recallTarget
    setRecallTarget(null)
    if (!target) return
    try {
      const res = await invoke('autoreply:recall', { recordId: target.id })
      if (res.ok) toast.success('已撤回这条自动回复')
      else toast.error('撤回失败', { detail: res.error })
    } catch (e) {
      toast.error('撤回失败', { detail: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <>
      <Card variant="rows" className="overflow-hidden">
        {loaded.loading && records.length === 0 ? (
          <SkeletonListRows rows={3} avatar={false} className="p-4" />
        ) : loaded.error ? (
          <EmptyState compact variant="error" title="读取记录失败" description={loaded.error.message} action={{ label: '重试', onClick: loaded.reload }} />
        ) : records.length === 0 ? (
          <EmptyState compact variant="empty" title="还没有自动回复记录" description="规则启用并触发后，回复会记录在这里" />
        ) : (
          records.map((r) => <RecordRow key={r.id} record={r} now={now} onView={view} onRecall={setRecallTarget} />)
        )}
      </Card>
      <RecordsDrawer open={drawerOpen} onOpenChange={onDrawerOpenChange} sessionId={sessionId} sessionTitle={sessionTitle} onView={view} onRecall={setRecallTarget} />
      <DangerDialog
        open={recallTarget !== null}
        onOpenChange={(o) => !o && setRecallTarget(null)}
        title="撤回这条自动回复？"
        description="仅当消息发送不超过 2 分钟时可撤回；撤回后对方会看到「撤回了一条消息」。"
        confirmLabel="撤回"
        onConfirm={recall}
      >
        {recallTarget ? <div className="rounded-item border border-line-8 bg-content px-3 py-2 text-caption text-fg-2">{recallTarget.replyText}</div> : null}
      </DangerDialog>
    </>
  )
}

export function ViewAllLink({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="link" size="sm" onClick={onClick}>
      查看全部
    </Button>
  )
}
