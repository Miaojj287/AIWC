/**
 * 已克隆 page (Figma 145:415): header (分身名 + meta + 重新克隆 / 删除) over two columns —
 * persona test chat (left) and the editable profile (right).
 */
import { RefreshCw, Trash } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CloneStatus, RelationshipProfile, ThreadId } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Avatar, Button, EmptyState, toast } from '@/kit'
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

export function ReadyView({
  contactId,
  name,
  avatarPath,
  status,
  messageCount,
  modelLabel,
  threadId,
  onThreadId,
  onReclone,
  onDeleted,
  selfName,
}: ReadyViewProps) {
  const t = useT()
  const loaded = useInvoke('clone:get', { contactId }, [contactId, status.version, status.builtAt])
  const notes = useInvoke('clone:notes', { contactId }, [contactId, status.version])
  const [profile, setProfile] = useState<RelationshipProfile | undefined>()
  const [dialog, setDialog] = useState<'reclone' | 'delete' | null>(null)
  const [refining, setRefining] = useState(false)

  useEffect(() => {
    if (loaded.data) setProfile(loaded.data)
  }, [loaded.data])

  /** Saves a profile edit; a failure is toasted here and reported as `false`, so callers never toast success too. */
  const patch = async (p: Partial<Pick<RelationshipProfile, 'card' | 'deep' | 'samples'>>): Promise<boolean> => {
    try {
      const next = await invoke('clone:updateProfile', { contactId, patch: p })
      setProfile(next)
      return true
    } catch (e) {
      toast.error(t('clone.ready.updateFailed'), { detail: message(e) })
      return false
    }
  }

  const refine = async () => {
    if (!profile) return
    setRefining(true)
    try {
      const next = await invoke('clone:updateProfile', {
        contactId,
        patch: { card: profile.card, deep: profile.deep, samples: profile.samples },
      })
      setProfile(next)
      toast.success(t('clone.ready.updated'), {
        detail: t('clone.ready.updatedDetail', {
          tones: next.card.tone.length,
          catchphrases: next.card.catchphrases.length,
          samples: next.samples.length,
        }),
      })
    } catch (e) {
      toast.error(t('clone.ready.refineFailed'), { detail: message(e) })
    } finally {
      setRefining(false)
    }
  }

  const saveSample = async (reply: string): Promise<boolean> => {
    if (!profile) {
      toast.error(t('clone.ready.updateFailed'), { detail: loaded.error?.message })
      return false
    }
    return patch({ samples: appendSample(profile.samples, '', reply, Date.now()) })
  }

  const deleteNote = async (at: number) => {
    try {
      await invoke('clone:deleteNote', { contactId, at })
      notes.reload()
      toast.success(t('clone.ready.noteDeleted'))
    } catch (e) {
      toast.error(t('clone.ready.deleteNoteFailed'), { detail: message(e) })
    }
  }

  const remove = async () => {
    try {
      await invoke('clone:delete', { contactId })
      setDialog(null)
      toast.success(t('clone.toast.deleted', { name }))
      onDeleted()
    } catch (e) {
      toast.error(t('clone.toast.deleteFailed'), { detail: message(e) })
    }
  }

  const meta = `${messageCount !== undefined ? `${t('clone.ready.basedOn', { n: messageCount, count: messageCount.toLocaleString('en-US') })} · ` : ''}${t('clone.ready.built', { when: formatRelative(status.builtAt) })}${profile ? ` · ${profileMeta(profile, status, modelLabel)}` : ''}`

  return (
    // A container, not the viewport: the workspace can be 400px wide while the window is 1400px.
    <div className="@container flex h-full min-h-0 flex-col">
      <header className="flex min-h-18 shrink-0 items-center gap-3 border-b border-line-6 px-5 py-3">
        <Avatar id={contactId} name={name} src={avatarPath} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 truncate text-bubble font-semibold leading-5 text-fg">
            {t('clone.ready.title', { name })}
          </span>
          <span className="truncate text-caption text-fg-3" title={meta}>
            {meta}
          </span>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={() => setDialog('reclone')}>
          {t('clone.actions.reclone')}
        </Button>
        <Button variant="ghost" icon={Trash} onClick={() => setDialog('delete')}>
          {t('common.delete')}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 @max-[720px]:flex-col">
        <PersonaChat
          contactId={contactId}
          name={name}
          avatarPath={avatarPath}
          threadId={threadId}
          onThreadId={onThreadId}
          onSaveSample={saveSample}
          selfName={selfName}
          onNotesChanged={notes.reload}
        />
        {profile ? (
          <ProfileEditor
            profile={profile}
            onPatch={patch}
            onRefine={refine}
            refining={refining}
            notes={notes.data ?? []}
            onDeleteNote={deleteNote}
          />
        ) : (
          <aside className="flex w-[260px] shrink-0 items-center justify-center border-l border-line-6 @max-[720px]:w-full @max-[720px]:border-l-0 @max-[720px]:border-t">
            {loaded.error ? (
              <EmptyState
                compact
                variant="error"
                title={t('clone.ready.profileLoadFailed')}
                description={loaded.error.message}
                action={{ label: t('common.retry'), onClick: loaded.reload }}
              />
            ) : (
              <EmptyState compact variant="loading" title={t('clone.ready.profileLoading')} />
            )}
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
      <DeleteCloneDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        name={name}
        onConfirm={remove}
      />
    </div>
  )
}
