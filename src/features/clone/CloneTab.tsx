/**
 * AI 克隆 Tab (kind 'clone', objectId = contactId). One tab, three states driven by clone:status +
 * 'clone:status' pushes: 未克隆 confirm page → 克隆中 progress card → 已克隆 chat + profile; 失败 = confirm
 * page + a dialog that distinguishes 模型错误 from 有效消息过少 (DESIGN-SPEC §4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CloneStatus, ModelSelection, ThreadId } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { EmptyState, toast } from '@/kit'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { rangeToQuery, viewFor, type TrainingRange } from './cloneView'
import { BuildingView } from './views/BuildingView'
import { CloneFailedDialog } from './views/CloneDialogs'
import { IdleView, type CloneParams } from './views/IdleView'
import { ReadyView } from './views/ReadyView'

interface CloneTabState {
  range?: TrainingRange
  model?: ModelSelection
  personaThreadId?: string
  /** Mirrors status 'building' so the registered tab title (index.ts) can switch to 克隆中 · {name}. */
  building?: boolean
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CloneTab({ tab, update }: TabRendererProps) {
  const t = useT()
  const contactId = tab.objectId
  const state = (tab.state ?? {}) as CloneTabState
  const loaded = useInvoke('clone:status', { contactId }, [contactId])
  const session = useInvoke('substrate:getSession', { id: contactId }, [contactId])
  const substrate = useInvoke('substrate:status', undefined, [])
  const models = useInvoke('agent:listModels', undefined, [])
  const [live, setLive] = useState<CloneStatus | undefined>()
  const [starting, setStarting] = useState(false)
  const [failedDismissed, setFailedDismissed] = useState(false)
  const [lastMessageCount, setLastMessageCount] = useState<number | undefined>()

  useBridgeEvent('clone:status', (e) => {
    if (e.contactId !== contactId) return
    setLive(e.status)
    if (e.status.state === 'failed') setFailedDismissed(false)
  })
  useEffect(() => setLive(undefined), [contactId, loaded.data])

  const status = live ?? loaded.data
  useEffect(() => {
    if (status?.state === 'none') setLastMessageCount(status.messageCount)
  }, [status])

  // tab.title is the contact name only; the localized prefix comes from the tab registration.
  const name = session.data?.title ?? tab.title
  const building = status?.state === 'building'
  useEffect(() => {
    if (name !== tab.title || building !== Boolean(state.building))
      update({ title: name, state: { ...tab.state, building } })
  }, [building, name, state.building, tab.state, tab.title, update])

  const params = useMemo<CloneParams>(
    () => ({ range: state.range ?? 'year', model: state.model }),
    [state.range, state.model],
  )
  const setParams = useCallback(
    (p: CloneParams) => update({ state: { ...tab.state, range: p.range, model: p.model } }),
    [tab.state, update],
  )
  const setThreadId = useCallback(
    (id: ThreadId) => update({ state: { ...tab.state, personaThreadId: id } }),
    [tab.state, update],
  )

  const start = useCallback(
    async (opts: { keepCorrections?: boolean; range?: TrainingRange; model?: ModelSelection } = {}) => {
      setStarting(true)
      setFailedDismissed(true)
      try {
        const range = opts.range ?? params.range
        const model =
          opts.model ??
          params.model ??
          (models.data?.[0] ? { providerId: models.data[0].providerId, modelId: models.data[0].modelId } : undefined)
        await invoke('clone:start', {
          contactId,
          range: rangeToQuery(range, Date.now()),
          model,
          keepCorrections: opts.keepCorrections,
        })
      } catch (e) {
        toast.error(t('clone.toast.startFailed'), { detail: message(e) })
      } finally {
        setStarting(false)
      }
    },
    [contactId, params, models.data, t],
  )

  const cancel = useCallback(async () => {
    try {
      await invoke('clone:cancel', { contactId })
      toast.info(t('clone.toast.cancelled', { name }))
    } catch (e) {
      toast.error(t('clone.toast.cancelFailed'), { detail: message(e) })
    }
  }, [contactId, name, t])

  if (loaded.error)
    return (
      <EmptyState
        variant="error"
        title={t('clone.tabView.loadFailed')}
        description={loaded.error.message}
        action={{ label: t('common.retry'), onClick: loaded.reload }}
        className="h-full"
      />
    )
  if (!status) return <EmptyState variant="loading" title={t('clone.tabView.loading')} className="h-full" />

  const view = viewFor(status)
  const avatarPath = session.data?.avatarPath
  const localModel = models.data?.find((m) => m.local)
  const modelLabel = models.data?.find(
    (m) => params.model && m.providerId === params.model.providerId && m.modelId === params.model.modelId,
  )?.label

  switch (view) {
    case 'building':
      return (
        <BuildingView
          contactId={contactId}
          name={name}
          avatarPath={avatarPath}
          status={status as Extract<CloneStatus, { state: 'building' }>}
          onCancel={cancel}
        />
      )
    case 'ready':
      return (
        <ReadyView
          contactId={contactId}
          name={name}
          avatarPath={avatarPath}
          status={status as Extract<CloneStatus, { state: 'ready' }>}
          messageCount={lastMessageCount ?? session.data?.indexedCount}
          modelLabel={modelLabel}
          threadId={state.personaThreadId}
          onThreadId={setThreadId}
          onReclone={(keep) => start({ keepCorrections: keep })}
          onDeleted={() => loaded.reload()}
          selfName={substrate.data?.account?.nickname}
        />
      )
    default:
      return (
        <>
          <IdleView
            contactId={contactId}
            name={name}
            avatarPath={avatarPath}
            messageCount={
              status.state === 'none' ? status.messageCount : (lastMessageCount ?? session.data?.indexedCount)
            }
            params={params}
            onParamsChange={setParams}
            onStart={() => void start()}
            starting={starting}
          />
          <CloneFailedDialog
            status={status.state === 'failed' ? status : undefined}
            open={status.state === 'failed' && !failedDismissed}
            onClose={() => setFailedDismissed(true)}
            onRetry={() => void start()}
            onUseLocalModel={
              localModel
                ? () => {
                    const model = { providerId: localModel.providerId, modelId: localModel.modelId }
                    setParams({ ...params, model })
                    void start({ model })
                  }
                : undefined
            }
            onWidenRange={() => {
              setParams({ ...params, range: 'all' })
              setFailedDismissed(true)
              toast.info(t('clone.toast.rangeWidened'))
            }}
          />
        </>
      )
  }
}
