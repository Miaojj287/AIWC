/**
 * AI 克隆 Tab (kind 'clone', objectId = contactId). One tab, three states driven by clone:status +
 * 'clone:status' pushes: 未克隆 confirm page → 克隆中 progress card → 已克隆 chat + profile; 失败 = confirm
 * page + a dialog that distinguishes 模型错误 from 有效消息过少 (DESIGN-SPEC §4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CloneStatus, ModelSelection, ThreadId } from '@aiwc/protocol'
import { EmptyState, toast } from '@/kit'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { rangeToQuery, viewFor, type TrainingRange } from './cloneView'
import { BuildingView } from './views/BuildingView'
import { CloneFailedDialog } from './views/CloneDialogs'
import { IdleView, type CloneParams } from './views/IdleView'
import { ReadyView } from './views/ReadyView'

export const CLONE_TAB_PREFIX = 'AI 克隆 · '
export const CLONE_BUILDING_PREFIX = '克隆中 · '

interface CloneTabState {
  range?: TrainingRange
  model?: ModelSelection
  personaThreadId?: string
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CloneTab({ tab, update }: TabRendererProps) {
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

  const name = session.data?.title ?? tab.title.replace(CLONE_TAB_PREFIX, '').replace(CLONE_BUILDING_PREFIX, '')
  useEffect(() => {
    const next = status?.state === 'building' ? `${CLONE_BUILDING_PREFIX}${name}` : `${CLONE_TAB_PREFIX}${name}`
    if (next !== tab.title) update({ title: next })
  }, [status?.state, name, tab.title, update])

  const params = useMemo<CloneParams>(() => ({ range: state.range ?? 'year', model: state.model }), [state.range, state.model])
  const setParams = useCallback((p: CloneParams) => update({ state: { ...tab.state, range: p.range, model: p.model } }), [tab.state, update])
  const setThreadId = useCallback((id: ThreadId) => update({ state: { ...tab.state, personaThreadId: id } }), [tab.state, update])

  const start = useCallback(
    async (opts: { keepCorrections?: boolean; range?: TrainingRange; model?: ModelSelection } = {}) => {
      setStarting(true)
      setFailedDismissed(true)
      try {
        const range = opts.range ?? params.range
        const model = opts.model ?? params.model ?? (models.data?.[0] ? { providerId: models.data[0].providerId, modelId: models.data[0].modelId } : undefined)
        await invoke('clone:start', { contactId, range: rangeToQuery(range, Date.now()), model, keepCorrections: opts.keepCorrections })
      } catch (e) {
        toast.error('无法开始克隆', { detail: message(e) })
      } finally {
        setStarting(false)
      }
    },
    [contactId, params, models.data],
  )

  const cancel = useCallback(async () => {
    try {
      await invoke('clone:cancel', { contactId })
      toast.info(`已取消克隆「${name}」`)
    } catch (e) {
      toast.error('取消失败', { detail: message(e) })
    }
  }, [contactId, name])

  if (loaded.error) return <EmptyState variant="error" title="读取克隆状态失败" description={loaded.error.message} action={{ label: '重试', onClick: loaded.reload }} className="h-full" />
  if (!status) return <EmptyState variant="loading" title="读取克隆状态…" className="h-full" />

  const view = viewFor(status)
  const avatarPath = session.data?.avatarPath
  const localModel = models.data?.find((m) => m.local)
  const modelLabel = models.data?.find((m) => params.model && m.providerId === params.model.providerId && m.modelId === params.model.modelId)?.label

  switch (view) {
    case 'building':
      return <BuildingView contactId={contactId} name={name} avatarPath={avatarPath} status={status as Extract<CloneStatus, { state: 'building' }>} onCancel={cancel} />
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
          <IdleView contactId={contactId} name={name} avatarPath={avatarPath} messageCount={status.state === 'none' ? status.messageCount : lastMessageCount ?? session.data?.indexedCount} params={params} onParamsChange={setParams} onStart={() => void start()} starting={starting} />
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
              toast.info('训练范围已改为「全部」，确认后重新开始克隆')
            }}
          />
        </>
      )
  }
}
