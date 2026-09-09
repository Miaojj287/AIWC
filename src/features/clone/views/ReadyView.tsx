/**
 * 已克隆 page (Figma 145:415): header (分身名 + version badge + meta + 重新克隆 / 删除) over two columns —
 * persona test chat (left) and the editable profile (right).
 */
import { RefreshCw, Trash } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CloneStatus, RelationshipProfile, ThreadId } from '@aiwc/protocol'
import { Avatar, Badge, Button, EmptyState, toast } from '@/kit'
import { formatRelative } from '@/platform/format'
import { invoke, useInvoke } from '@/platform/hooks'
import { appendSample, profileMeta } from '../profileModel'
import { DeleteCloneDialog, RecloneDialog } from './CloneDialogs'
import { PersonaChat } from './PersonaChat'
import { ProfileEditor } from './ProfileEditor'

export interface ReadyViewProps {
  contactId: string
  name: string
  avatarPath?: string
  status: Extract<CloneStatus, { state: 'ready' }>
  messageCount: number | undefined
  modelLabel?: string
  threadId: string | undefined
  onThreadId: (id: ThreadId) => void
  onReclone: (keepCorrections: boolean) => Promise<void>
  onDeleted: () => void
  selfName?: string
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ReadyView({ contactId, name, avatarPath, status, messageCount, modelLabel, threadId, onThreadId, onReclone, onDeleted, selfName }: ReadyViewProps) {
  const loaded = useInvoke('clone:get', { contactId }, [contactId, status.version, status.builtAt])
  const notes = useInvoke('clone:notes', { contactId }, [contactId, status.version])
  const [profile, setProfile] = useState<RelationshipProfile | undefined>()
  const [dialog, setDialog] = useState<'reclone' | 'delete' | null>(null)
  const [refining, setRefining] = useState(false)

  useEffect(() => {
    if (loaded.data) setProfile(loaded.data)
  }, [loaded.data])

  const patch = async (p: Partial<Pick<RelationshipProfile, 'card' | 'deep' | 'samples'>>) => {
    try {
      const next = await invoke('clone:updateProfile', { contactId, patch: p })
      setProfile(next)
    } catch (e) {
      toast.error('更新画像失败', { detail: message(e) })
    }
  }

  const refine = async () => {
    if (!profile) return
    setRefining(true)
    try {
      const next = await invoke('clone:updateProfile', { contactId, patch: { card: profile.card, deep: profile.deep, samples: profile.samples } })
      setProfile(next)
      toast.success('画像已更新', { detail: `${next.card.tone.length} 个语气标签 · ${next.card.catchphrases.length} 个口头禅 · ${next.samples.length} 个样本` })
    } catch (e) {
      toast.error('重新提炼失败', { detail: message(e) })
    } finally {
      setRefining(false)
    }
  }

  const saveSample = async (reply: string) => {
    if (!profile) return
    await patch({ samples: appendSample(profile.samples, '', reply, Date.now()) })
  }

  const deleteNote = async (at: number) => {
    try {
      await invoke('clone:deleteNote', { contactId, at })
      notes.reload()
    } catch (e) {
      toast.error('删除纠正失败', { detail: message(e) })
    }
  }

  const remove = async () => {
    try {
      await invoke('clone:delete', { contactId })
      setDialog(null)
      toast.success(`已删除「${name}」的分身`)
      onDeleted()
    } catch (e) {
      toast.error('删除失败', { detail: message(e) })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-6 px-5">
        <Avatar id={contactId} name={name} src={avatarPath} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-bubble font-medium leading-5 text-fg">{name} 的分身</span>
            <Badge tone="ok">已克隆 · v{status.version}</Badge>
          </div>
          <span className="truncate text-caption text-fg-3">
            {messageCount !== undefined ? `基于 ${messageCount.toLocaleString('en-US')} 条消息 · ` : ''}
            {formatRelative(status.builtAt)}生成
            {profile ? ` · ${profileMeta(profile, status, modelLabel)}` : ''}
          </span>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={() => setDialog('reclone')}>
          重新克隆
        </Button>
        <Button variant="ghost" icon={Trash} className="text-danger hover:text-danger" onClick={() => setDialog('delete')}>
          删除
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <PersonaChat contactId={contactId} name={name} avatarPath={avatarPath} threadId={threadId} onThreadId={onThreadId} onSaveSample={saveSample} selfName={selfName} onNotesChanged={notes.reload} />
        {profile ? (
          <ProfileEditor profile={profile} messageCount={messageCount} onPatch={patch} onRefine={refine} refining={refining} notes={notes.data ?? []} onDeleteNote={deleteNote} />
        ) : (
          <aside className="flex w-[260px] shrink-0 items-center justify-center border-l border-line-6">
            {loaded.error ? <EmptyState compact variant="error" title="读取画像失败" description={loaded.error.message} action={{ label: '重试', onClick: loaded.reload }} /> : <EmptyState compact variant="loading" title="读取画像…" />}
          </aside>
        )}
      </div>
      <RecloneDialog
        open={dialog === 'reclone'}
        onOpenChange={(o) => !o && setDialog(null)}
        name={name}
        messageCount={messageCount}
        version={status.version}
        onConfirm={(keep) => {
          setDialog(null)
          void onReclone(keep)
        }}
      />
      <DeleteCloneDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} name={name} onConfirm={remove} />
    </div>
  )
}
