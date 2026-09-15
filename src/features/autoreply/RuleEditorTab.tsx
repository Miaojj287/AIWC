/**
 * 自动回复规则 Tab (kind 'autoreply', objectId = sessionId): header · 状态 · 回复方式 · 最近记录 ·
 * sticky save bar with dirty state.
 */
import { AutoReplyControl } from './AutoReplyControl'
import { runCommand } from '@/app/commands'
import { Clock, Copy, Ellipsis, Inbox, Pause, Play, Trash, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DangerDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  ScrollArea,
  Toggle,
  toast,
  type MenuSpec,
} from '@/kit'
import { formatTime } from '@/platform/format'
import { invoke, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { CopyRuleDialog } from './editor/CopyRuleDialog'
import { RecordsCard, ViewAllLink } from './editor/RecordsCard'
import { ReplyCard } from './editor/ReplyCard'
import { ruleStatusLine } from './ruleModel'
import { useRuleEditor } from './useRuleEditor'

export function RuleEditorTab({ tab, update }: TabRendererProps) {
  const t = useT()
  const sessionId = tab.objectId
  const session = useInvoke('substrate:getSession', { id: sessionId }, [sessionId])
  const title = session.data?.title ?? tab.title
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
      toast.error(t('autoreply.editor.triggerFailed'), { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setTriggering(false)
    }
  }

  useEffect(() => {
    if (tab.dirty !== editor.dirty) update({ dirty: editor.dirty })
  }, [editor.dirty, tab.dirty, update])

  if (editor.loading || (!editor.draft && !editor.error))
    return <EmptyState variant="loading" title={t('autoreply.editor.loading')} className="h-full" />
  if (editor.error || !editor.draft)
    return (
      <EmptyState
        variant="error"
        title={t('autoreply.editor.loadFailed')}
        description={editor.error?.message}
        action={{ label: t('common.retry'), onClick: editor.reload }}
        className="h-full"
      />
    )

  const draft = editor.draft
  const saved = editor.saved
  const status = ruleStatusLine(editor.exists ? (saved ?? undefined) : undefined)
  const kindLabel =
    session.data?.kind === 'group'
      ? t('autoreply.editor.kindGroup')
      : session.data?.kind === 'dm'
        ? t('autoreply.editor.kindDm')
        : ''
  const meta = [
    kindLabel,
    session.data?.memberCount ? t('autoreply.editor.members', { n: session.data.memberCount }) : '',
    saved?.todayCount
      ? t('autoreply.editor.repliedToday', { n: saved.todayCount })
      : editor.exists
        ? t('autoreply.editor.notTriggeredToday')
        : t('autoreply.editor.noRuleYet'),
  ]
    .filter(Boolean)
    .join(' · ')

  const menu: MenuSpec = [
    editor.exists && draft.enabled
      ? { id: 'pause', label: t('autoreply.rule.pause'), icon: Pause, onSelect: () => void editor.setEnabled(false) }
      : {
          id: 'resume',
          label: t('autoreply.rule.enable'),
          icon: Play,
          disabled: !editor.exists,
          onSelect: () => void editor.setEnabled(true),
        },
    {
      id: 'copy',
      label: t('autoreply.editor.copyToOthers'),
      icon: Copy,
      disabled: !editor.exists,
      onSelect: () => setDialog('copy'),
    },
    { id: 'records', label: t('autoreply.editor.viewAllRecords'), icon: Clock, onSelect: () => setDrawerOpen(true) },
    {
      id: 'desk',
      label: t('autoreply.editor.openReplyDesk'),
      icon: Inbox,
      onSelect: () => runCommand('tab.openReplyDesk'),
    },
    { type: 'separator' },
    {
      id: 'delete',
      label: t('autoreply.rule.delete'),
      icon: Trash,
      danger: true,
      disabled: !editor.exists,
      onSelect: () => setDialog('delete'),
    },
  ]

  const saveReason = !editor.valid
    ? Object.values(editor.errors)[0]
    : !editor.dirty
      ? t('autoreply.editor.nothingToSave')
      : undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
        <Avatar id={sessionId} name={title} src={session.data?.avatarPath} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-bubble font-medium leading-5 text-fg">{title}</span>
            <Badge tone={status.kind === 'on' ? 'ok' : status.kind === 'paused' ? 'neutral' : 'neutral'}>
              {status.kind === 'on'
                ? t('autoreply.editor.badgeOn')
                : status.kind === 'paused'
                  ? t('autoreply.status.paused')
                  : t('autoreply.status.unset')}
            </Badge>
          </div>
          <span className="truncate text-caption text-fg-3">{meta}</span>
        </div>
        <label className="flex items-center gap-2 text-caption text-fg-2">
          {t('common.enable')}
          <Toggle
            label={t('autoreply.rule.enable')}
            checked={draft.enabled}
            onCheckedChange={(v) => void editor.setEnabled(v)}
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={Ellipsis} label={t('autoreply.rule.moreActions')} />
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
            <h2 className="text-caption text-fg-3">{t('autoreply.editor.replySection')}</h2>
            <ReplyCard draft={draft} errors={editor.errors} patch={editor.patch} />
          </section>
          <section className="flex flex-col gap-2">
            <div className="flex items-center">
              <h2 className="text-caption text-fg-3">{t('autoreply.editor.recentSection')}</h2>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Zap}
                  loading={triggering}
                  disabled={!editor.exists || !draft.enabled}
                  title={
                    !editor.exists
                      ? t('autoreply.editor.triggerNeedsSave')
                      : !draft.enabled
                        ? t('autoreply.editor.triggerNeedsEnable')
                        : t('autoreply.editor.triggerHint')
                  }
                  onClick={() => void triggerOnce()}
                >
                  {t('autoreply.editor.triggerNow')}
                </Button>
                <ViewAllLink onClick={() => setDrawerOpen(true)} />
              </span>
            </div>
            <RecordsCard
              sessionId={sessionId}
              sessionTitle={title}
              drawerOpen={drawerOpen}
              onDrawerOpenChange={setDrawerOpen}
            />
          </section>
        </div>
      </ScrollArea>

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line-6 px-5">
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3">
          {editor.exists && saved?.updatedAt
            ? t('autoreply.editor.lastSaved', { time: formatTime(saved.updatedAt) })
            : t('autoreply.editor.notSaved')}
          {editor.dirty ? ` · ${t('autoreply.editor.unsaved')}` : ''}
        </span>
        <Button variant="ghost" disabled={!editor.dirty} onClick={() => setDialog('discard')}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!editor.dirty || !editor.valid}
          loading={editor.saving}
          title={saveReason}
          onClick={() => void editor.save()}
        >
          {t('autoreply.editor.saveRule')}
        </Button>
      </footer>

      {editor.exists && saved ? (
        <CopyRuleDialog
          open={dialog === 'copy'}
          onOpenChange={(o) => !o && setDialog(null)}
          rule={saved}
          sourceTitle={title}
        />
      ) : null}
      <DangerDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('autoreply.rule.deleteTitle', { name: title })}
        description={t('autoreply.rule.deleteDescription')}
        onConfirm={async () => {
          setDialog(null)
          await editor.remove()
        }}
      />
      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('autoreply.editor.discardTitle')}
        description={t('autoreply.editor.discardDescription')}
        confirmLabel={t('autoreply.editor.discard')}
        cancelLabel={t('autoreply.editor.keepEditing')}
        tone="warn"
        onConfirm={() => {
          editor.reset()
          setDialog(null)
        }}
      />
    </div>
  )
}
