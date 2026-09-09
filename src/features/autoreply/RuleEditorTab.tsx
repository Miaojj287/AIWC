/**
 * 自动回复规则 Tab (kind 'autoreply', objectId = sessionId): header · 状态 · 回复方式 · 最近记录 ·
 * sticky save bar with dirty state.
 */
import { AutoReplyControl } from './AutoReplyControl'
import { runCommand } from '@/app/commands'
import { Clock, Copy, Ellipsis, Inbox, Pause, Play, Trash, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar, Badge, Button, ConfirmDialog, DangerDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItems, DropdownMenuTrigger, EmptyState, IconButton, ScrollArea, Toggle, toast, type MenuSpec } from '@/kit'
import { formatTime } from '@/platform/format'
import { invoke, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { CopyRuleDialog } from './editor/CopyRuleDialog'
import { RecordsCard, ViewAllLink } from './editor/RecordsCard'
import { ReplyCard } from './editor/ReplyCard'
import { ruleStatusLine } from './ruleModel'
import { useRuleEditor } from './useRuleEditor'

export const AUTOREPLY_TAB_PREFIX = '自动回复 · '

export function RuleEditorTab({ tab, update }: TabRendererProps) {
  const sessionId = tab.objectId
  const session = useInvoke('substrate:getSession', { id: sessionId }, [sessionId])
  const title = session.data?.title ?? tab.title.replace(AUTOREPLY_TAB_PREFIX, '')
  const editor = useRuleEditor(sessionId, title)
  const [dialog, setDialog] = useState<'copy' | 'delete' | 'discard' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [triggering, setTriggering] = useState(false)

  /** Debug affordance: run the rule against this chat's last message without waiting for a new one. */
  const triggerOnce = async () => {
    setTriggering(true)
    try {
      await invoke('autoreply:triggerNow', { sessionId })
    } catch (e) {
      toast.error('触发失败', { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setTriggering(false)
    }
  }

  useEffect(() => {
    if (tab.dirty !== editor.dirty) update({ dirty: editor.dirty })
  }, [editor.dirty, tab.dirty, update])

  if (editor.loading || (!editor.draft && !editor.error)) return <EmptyState variant="loading" title="读取规则…" className="h-full" />
  if (editor.error || !editor.draft) return <EmptyState variant="error" title="读取规则失败" description={editor.error?.message} action={{ label: '重试', onClick: editor.reload }} className="h-full" />

  const draft = editor.draft
  const saved = editor.saved
  const status = ruleStatusLine(editor.exists ? saved ?? undefined : undefined)
  const kindLabel = session.data?.kind === 'group' ? '群聊' : session.data?.kind === 'dm' ? '单聊' : ''
  const meta = [kindLabel, session.data?.memberCount ? `${session.data.memberCount} 人` : '', saved?.todayCount ? `今日已自动回复 ${saved.todayCount} 次` : editor.exists ? '今日尚未触发' : '尚未设置规则'].filter(Boolean).join(' · ')

  const menu: MenuSpec = [
    editor.exists && draft.enabled
      ? { id: 'pause', label: '暂停规则', icon: Pause, onSelect: () => void editor.setEnabled(false) }
      : { id: 'resume', label: '启用规则', icon: Play, disabled: !editor.exists, onSelect: () => void editor.setEnabled(true) },
    { id: 'copy', label: '复制规则到其他会话…', icon: Copy, disabled: !editor.exists, onSelect: () => setDialog('copy') },
    { id: 'records', label: '查看全部回复记录', icon: Clock, onSelect: () => setDrawerOpen(true) },
    { id: 'desk', label: '打开回复台', icon: Inbox, onSelect: () => runCommand('tab.openReplyDesk') },
    { type: 'separator' },
    { id: 'delete', label: '删除规则', icon: Trash, danger: true, disabled: !editor.exists, onSelect: () => setDialog('delete') },
  ]

  const saveReason = !editor.valid ? Object.values(editor.errors)[0] : !editor.dirty ? '没有需要保存的修改' : undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
        <Avatar id={sessionId} name={title} src={session.data?.avatarPath} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-bubble font-medium leading-5 text-fg">{title}</span>
            <Badge tone={status.kind === 'on' ? 'ok' : status.kind === 'paused' ? 'neutral' : 'neutral'}>{status.kind === 'on' ? '自动回复已开启' : status.kind === 'paused' ? '已暂停' : '未设置'}</Badge>
          </div>
          <span className="truncate text-caption text-fg-3">{meta}</span>
        </div>
        <label className="flex items-center gap-2 text-caption text-fg-2">
          启用
          <Toggle label="启用规则" checked={draft.enabled} onCheckedChange={(v) => void editor.setEnabled(v)} />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={Ellipsis} label="更多操作" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItems items={menu} />
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex w-full max-w-[880px] flex-col gap-4 px-5 pb-6 pt-4">
          <AutoReplyControl />
          <section className="flex flex-col gap-2">
            <h2 className="text-caption text-fg-3">这个会话怎么回</h2>
            <ReplyCard draft={draft} errors={editor.errors} patch={editor.patch} />
          </section>
          <section className="flex flex-col gap-2">
            <div className="flex items-center">
              <h2 className="text-caption text-fg-3">最近自动回复</h2>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Zap}
                  loading={triggering}
                  disabled={!editor.exists || !draft.enabled}
                  title={!editor.exists ? '先保存规则' : !draft.enabled ? '先启用这个会话的自动回复' : '立刻按当前设定回一次最后那条消息'}
                  onClick={() => void triggerOnce()}
                >
                  立即触发一次
                </Button>
                <ViewAllLink onClick={() => setDrawerOpen(true)} />
              </span>
            </div>
            <RecordsCard sessionId={sessionId} sessionTitle={title} drawerOpen={drawerOpen} onDrawerOpenChange={setDrawerOpen} />
          </section>
        </div>
      </ScrollArea>

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line-6 px-5">
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3">
          {editor.exists && saved?.updatedAt ? `上次保存 ${formatTime(saved.updatedAt)}` : '尚未保存'}
          {editor.dirty ? ' · 有未保存的修改' : ''}
        </span>
        <Button variant="ghost" disabled={!editor.dirty} onClick={() => setDialog('discard')}>
          取消
        </Button>
        <Button variant="primary" disabled={!editor.dirty || !editor.valid} loading={editor.saving} title={saveReason} onClick={() => void editor.save()}>
          保存规则
        </Button>
      </footer>

      {editor.exists && saved ? <CopyRuleDialog open={dialog === 'copy'} onOpenChange={(o) => !o && setDialog(null)} rule={saved} sourceTitle={title} /> : null}
      <DangerDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`删除「${title}」的规则？`}
        description="回复方式与设定会被删除，历史回复记录保留。"
        onConfirm={async () => {
          setDialog(null)
          await editor.remove()
        }}
      />
      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="放弃未保存的修改？"
        description="你修改了这个会话的回复设置，放弃后这些改动不会保留。"
        confirmLabel="放弃"
        cancelLabel="继续编辑"
        tone="warn"
        onConfirm={() => {
          editor.reset()
          setDialog(null)
        }}
      />
    </div>
  )
}
