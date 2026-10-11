import { discoverModels, listRemoteModels, testModel } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'
import { isProviderKeyRef } from '../security/secretRefPolicy'

export function registerAiIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:ai')
  // The provider comes from the renderer: its apiKeyRef may only name a provider key, never another secret (the
  // iLink session, an MCP token, the database key) that a test call would then send to the renderer-chosen baseUrl.
  const storedKey = (ref: string | undefined): string | undefined => {
    if (!ref) return undefined
    if (!isProviderKeyRef(ref)) throw new Error(t('main.config.secretRefRefused', { ref: ref.slice(0, 128) }))
    return ctx.secrets.reveal(ref) ?? undefined
  }

  handle('ai:testModel', ({ provider, modelId, apiKey }) => {
    const key = apiKey ?? storedKey(provider.apiKeyRef)
    return testModel({ provider, modelId, apiKey: key, fetchImpl: ctx.modelOps.fetchFor(provider) })
  })

  handle('ai:discoverModels', ({ provider, apiKey }) => {
    const key = apiKey ?? storedKey(provider.apiKeyRef)
    return discoverModels({ provider, apiKey: key, fetchImpl: ctx.modelOps.fetchFor(provider) })
  })

  handle('ai:listRemoteModels', ({ provider, apiKey }) => {
    const key = apiKey ?? storedKey(provider.apiKeyRef)
    return listRemoteModels({ provider, apiKey: key, fetchImpl: ctx.modelOps.fetchFor(provider) })
  })

  // Local speech-to-text runtime is not part of this milestone. The settings page still renders
  // (empty list + the online tab); every call answers instead of hanging.
  handle('ai:listLocalSttModels', () => {
    log.debug('local STT models requested; runtime not available yet')
    return []
  })
  handle('ai:downloadSttModel', ({ id }) => {
    log.warn('downloadSttModel ignored: local STT runtime not available', { id })
    throw new Error(t('main.ai.localSttUnavailable'))
  })
  handle('ai:cancelSttDownload', ({ id }) => {
    log.debug('cancelSttDownload no-op', { id })
  })
  handle('ai:deleteSttModel', ({ id }) => {
    log.debug('deleteSttModel no-op', { id })
  })
  handle('ai:setDefaultSttModel', ({ id }) => {
    const stt = ctx.config.get().ai.stt
    ctx.config.set({ ai: { stt: { ...stt, localModelId: id } } })
  })
}
