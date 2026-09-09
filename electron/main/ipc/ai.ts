import { discoverModels, listRemoteModels, testModel } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

export function registerAiIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:ai')

  handle('ai:testModel', ({ provider, modelId, apiKey }) => {
    const key = apiKey ?? (provider.apiKeyRef ? ctx.secrets.reveal(provider.apiKeyRef) ?? undefined : undefined)
    return testModel({ provider, modelId, apiKey: key })
  })

  handle('ai:discoverModels', ({ provider, apiKey }) => {
    const key = apiKey ?? (provider.apiKeyRef ? ctx.secrets.reveal(provider.apiKeyRef) ?? undefined : undefined)
    return discoverModels({ provider, apiKey: key })
  })

  handle('ai:listRemoteModels', ({ provider, apiKey }) => {
    const key = apiKey ?? (provider.apiKeyRef ? ctx.secrets.reveal(provider.apiKeyRef) ?? undefined : undefined)
    return listRemoteModels({ provider, apiKey: key })
  })

  // Local speech-to-text runtime is not part of this milestone. The settings page still renders
  // (empty list + the online tab); every call answers instead of hanging.
  handle('ai:listLocalSttModels', () => {
    log.debug('local STT models requested; runtime not available yet')
    return []
  })
  handle('ai:downloadSttModel', ({ id }) => {
    log.warn('downloadSttModel ignored: local STT runtime not available', { id })
    throw new Error('本地语音模型下载暂未提供，请先使用在线转写')
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
