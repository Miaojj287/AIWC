/**
 * app:*, config:*, secret:*, ai:* and file:* for the mock bridge.
 */
import { modelCapabilities, type ModelTestResult } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const SECRETS_KEY = 'aiwc.mock.secrets'
const MOCK_VERSION = '0.1.0-web'

type SttModel = { id: string; label: string; sizeMb: number; state: 'absent' | 'downloading' | 'ready'; progress?: number; isDefault: boolean }

const REMOTE_MODELS: Record<string, string[]> = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'openai-compatible': ['deepseek-chat', 'qwen-plus', 'glm-4.5'],
  ollama: ['qwen3:8b', 'llama3.1:8b', 'gemma3:12b'],
}

const MEDIA_TYPES: Record<string, string> = { md: 'text/markdown', json: 'application/json', txt: 'text/plain', html: 'text/html', csv: 'text/csv', svg: 'image/svg+xml' }

export function miscHandlers(ctx: MockContext): HandlersFor<'app'> & HandlersFor<'config'> & HandlersFor<'secret'> & HandlersFor<'ai'> & HandlersFor<'file'> {
  const files = new Map<string, string>()
  const downloads = new Map<string, AbortController>()
  const stt: SttModel[] = [
    { id: 'sherpa-paraformer-zh', label: 'Paraformer 中文（离线）', sizeMb: 220, state: 'ready', isDefault: true },
    { id: 'sherpa-sense-voice', label: 'SenseVoice 多语种（离线）', sizeMb: 480, state: 'absent', isDefault: false },
    { id: 'whisper-small-zh', label: 'Whisper Small 中文（离线）', sizeMb: 460, state: 'absent', isDefault: false },
  ]
  const secrets = () => ctx.kv.get<Record<string, string>>(SECRETS_KEY, {})
  const sttById = (id: string) => {
    const m = stt.find((x) => x.id === id)
    if (!m) throw new Error(`未知的语音模型：${id}`)
    return m
  }

  async function download(model: SttModel, signal: AbortSignal) {
    model.state = 'downloading'
    model.progress = 0
    try {
      for (let i = 1; i <= 10; i++) {
        await ctx.delay(400, signal)
        model.progress = i / 10
      }
      model.state = 'ready'
      model.progress = undefined
      ctx.emit('app:toast', { kind: 'success', text: `${model.label} 下载完成` })
    } catch {
      model.state = 'absent'
      model.progress = undefined
    } finally {
      downloads.delete(model.id)
    }
  }

  return {
    'app:getInfo': () => ({ version: MOCK_VERSION, platform: ctx.platform, dataDir: '（浏览器演示模式，不写入磁盘）', isPackaged: false }),
    'app:checkUpdate': async () => {
      await ctx.delay(800)
      return { state: 'up_to_date', version: MOCK_VERSION }
    },
    'app:exportLogs': async () => {
      await ctx.delay(500)
      return { path: '~/Downloads/aiwc-logs.zip' }
    },
    'app:openPath': ({ path }) => {
      console.info('[mockBridge] openPath', path)
    },
    'app:openUrl': ({ url }) => {
      // Web preview has a real browser: open the link instead of only logging it.
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
      else console.info('[mockBridge] openUrl', url)
    },
    'app:pickDirectory': async ({ defaultPath }) => {
      await ctx.delay(300)
      return defaultPath ?? '/Users/demo/Documents/AIWC'
    },
    'app:setCloseBehaviorOnce': () => undefined,

    'config:get': () => ctx.config(),
    'config:set': (patch) => ctx.setConfig(patch),

    'secret:set': ({ ref, value }) => ctx.kv.set(SECRETS_KEY, { ...secrets(), [ref]: value }),
    'secret:has': ({ ref }) => ref in secrets(),
    'secret:reveal': ({ ref }) => secrets()[ref] ?? null,
    'secret:delete': ({ ref }) => {
      const next = { ...secrets() }
      delete next[ref]
      ctx.kv.set(SECRETS_KEY, next)
    },

    'ai:testModel': async ({ provider, modelId }) => {
      await ctx.delay(600)
      if (provider.baseUrl?.includes('fail')) {
        const res: ModelTestResult = { ok: false, error: { code: 'auth', message: '鉴权失败：请检查 API Key 或 Base URL', status: 401, retryable: false } }
        return res
      }
      return { ok: true, latencyMs: ctx.rng.int(320, 780), supportsTools: !/embed|whisper/i.test(modelId) }
    },
    'ai:discoverModels': async ({ provider }) => {
      await ctx.delay(500)
      if (provider.baseUrl?.includes('fail')) throw new Error('无法连接到模型服务')
      return (REMOTE_MODELS[provider.kind] ?? []).map(modelId => ({ modelId, label: modelId, contextWindow: 128_000, supportsTools: true, supportsVision: false, enabled: true, source: 'remote' as const, available: true, capabilities: modelCapabilities(provider, { modelId }) }))
    },
    'ai:listRemoteModels': async ({ provider }) => {
      await ctx.delay(500)
      if (provider.baseUrl?.includes('fail')) throw new Error('无法连接到模型服务')
      const known = REMOTE_MODELS[provider.kind] ?? []
      return [...new Set([...provider.models.map((m) => m.modelId), ...known])]
    },
    'ai:listLocalSttModels': () => stt.map((m) => ({ ...m })),
    'ai:downloadSttModel': ({ id }) => {
      const m = sttById(id)
      if (m.state !== 'absent') return
      const abort = new AbortController()
      downloads.set(id, abort)
      void download(m, abort.signal)
    },
    'ai:cancelSttDownload': ({ id }) => downloads.get(id)?.abort(),
    'ai:deleteSttModel': ({ id }) => {
      const m = sttById(id)
      if (m.isDefault) throw new Error('默认模型不能删除，请先切换默认模型')
      m.state = 'absent'
      m.progress = undefined
    },
    'ai:setDefaultSttModel': ({ id }) => {
      const m = sttById(id)
      if (m.state !== 'ready') throw new Error('只能把已下载的模型设为默认')
      for (const x of stt) x.isDefault = x.id === id
      ctx.setConfig({ ai: { ...ctx.config().ai, stt: { ...ctx.config().ai.stt, localModelId: id } } })
    },

    'file:read': ({ path }) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`文件不存在：${path}`)
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      return { content, mediaType: MEDIA_TYPES[ext] ?? 'text/plain' }
    },
    'file:write': ({ path, content }) => {
      files.set(path, content)
    },
    'file:reveal': ({ path }) => {
      console.info('[mockBridge] reveal', path)
    },
  }
}
