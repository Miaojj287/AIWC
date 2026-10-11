/**
 * Model wiring for the composition root: the resolver (kernel + features), the proxy-aware transport for provider
 * requests (设置 › AI 接入 › 网络), and usage.db with the call log (设置 › 用量与记录). Kept out of composition.ts,
 * which may only shrink (AGENTS.md §2.3).
 */
import {
  parseProxyUrl,
  type InvokeRes,
  type ModelCallDetail,
  type ModelCallRecord,
  type ModelClient,
  type ModelSelection,
  type ProviderConfig,
} from '@aiwc/protocol'
import type { ConfigService } from './config/configService'
import type { SecretStore } from './config/secretStore'
import type { Broadcast } from './contracts'
import type { Logger } from './log'
import type { AppPaths } from './paths'
import { createModelFetch, type ModelFetch } from './ai/modelFetch'
import { meterModelClient } from './ai/meteredClient'
import { createLowEffortModelFactory } from './ai/lowEffortModel'
import { createModelResolver } from './ai/modelResolver'
import { createUsageStore, type UsageStore } from './ai/usageStore'

/** 测试代理 gives up after this long. */
const PROXY_TEST_TIMEOUT_MS = 10_000
const PROXY_TEST_FALLBACK_URL = 'https://www.gstatic.com/generate_204'
const DEFAULT_ENDPOINTS: Partial<Record<ProviderConfig['kind'], string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
}

export interface ModelOps {
  usage: UsageStore
  network: ModelFetch
  /** Proxy-aware fetch for one provider (Ollama / loopback: the plain global fetch). */
  fetchFor(provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>): typeof globalThis.fetch | undefined
  testProxy(url?: string): Promise<InvokeRes<'models:testProxy'>>
  /** Background memory extraction: lowest-effort client, proxied and metered as `memory`. */
  lowEffortModel(selection: ModelSelection | undefined): Promise<ModelClient>
}

export interface ComposeModelsDeps {
  config: ConfigService
  secrets: SecretStore
  paths: Pick<AppPaths, 'usageDb'>
  broadcast: Broadcast
  logger: Logger
  /** Electron `session.defaultSession.resolveProxy`; without it 跟随系统 connects directly. */
  resolveProxy?: (url: string) => Promise<string>
  /** Registered cleanups, run by AppContext.shutdown(). */
  unsubscribers: Array<() => void>
}

function openUsageStore(file: string, log: Logger): UsageStore {
  try {
    return createUsageStore({ file })
  } catch (err) {
    // A damaged usage.db must not take the models down with it: keep this session's numbers in memory.
    log.warn('usage.db could not be opened; usage is kept in memory for this session', err)
    return createUsageStore({ file: ':memory:' })
  }
}

export function composeModels(deps: ComposeModelsDeps) {
  const log = deps.logger.child('models')
  const cfg = () => deps.config.get()
  const usage = openUsageStore(deps.paths.usageDb, log)
  const network = createModelFetch({
    proxy: () => cfg().ai.proxy,
    password: () => {
      const ref = cfg().ai.proxy.passwordRef
      return ref ? (deps.secrets.reveal(ref) ?? undefined) : undefined
    },
    resolveSystemProxy: deps.resolveProxy ?? (() => Promise.resolve('DIRECT')),
    logger: deps.logger,
  })

  const recordCall = (call: ModelCallDetail): void => {
    usage.record(call)
    const { request: _request, response: _response, errorMessage: _error, ...meta } = call
    deps.broadcast('models:callRecorded', meta satisfies ModelCallRecord)
  }
  const fetchFor = (provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>) =>
    provider.kind === 'ollama' ? undefined : network.fetch

  const models = createModelResolver({
    config: cfg,
    secrets: deps.secrets,
    logger: deps.logger,
    fetchFor,
    meter: (client, opts) => meterModelClient(client, opts, meterDeps),
  })

  let lastAiJson = JSON.stringify(cfg().ai)
  let lastProxyJson = JSON.stringify(cfg().ai.proxy)
  deps.unsubscribers.push(
    deps.config.subscribe((next, prev) => {
      const aiJson = JSON.stringify(next.ai)
      if (aiJson !== lastAiJson) {
        lastAiJson = aiJson
        models.invalidate()
      }
      const proxyJson = JSON.stringify(next.ai.proxy)
      if (proxyJson !== lastProxyJson) {
        lastProxyJson = proxyJson
        network.reset()
      }
      // Turning 记录内容 off also removes the content already recorded.
      if (prev.ai.callLog.recordContent && !next.ai.callLog.recordContent) usage.dropContent()
    }),
    () => {
      void network.dispose()
      usage.close()
    },
  )

  async function testProxy(url?: string): Promise<InvokeRes<'models:testProxy'>> {
    const target = url ?? defaultEndpoint() ?? PROXY_TEST_FALLBACK_URL
    const proxy = cfg().ai.proxy
    if (proxy.mode === 'manual' && !parseProxyUrl(proxy.url).ok)
      return { ok: false, route: 'proxy', errorCode: 'proxy_invalid' }
    const route = await network.route(target)
    const shown = route.kind === 'proxy' ? route.proxyUrl : undefined
    const started = Date.now()
    try {
      // Any HTTP answer (even 401 / 404) proves the path to the provider works; only a network failure does not.
      const res = await network.fetch(target, { method: 'GET', signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS) })
      void res.body?.cancel().catch(() => undefined)
      return {
        ok: true,
        route: route.kind === 'proxy' ? 'proxy' : 'direct',
        proxy: shown,
        latencyMs: Date.now() - started,
        httpStatus: res.status,
      }
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      return {
        ok: false,
        route: route.kind === 'proxy' ? 'proxy' : 'direct',
        proxy: shown,
        errorCode: timedOut ? 'timeout' : route.kind === 'invalid' ? 'proxy_invalid' : 'network',
        detail: err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err),
      }
    }
  }

  /** The endpoint of the default model, so 测试代理 checks the path that matters. */
  function defaultEndpoint(): string | undefined {
    const ai = cfg().ai
    const provider = ai.providers.find((p) => p.id === ai.defaultModel?.providerId) ?? ai.providers[0]
    if (!provider || provider.kind === 'ollama') return undefined
    return provider.baseUrl ?? DEFAULT_ENDPOINTS[provider.kind]
  }

  const lowEffort = createLowEffortModelFactory({ config: cfg, secrets: deps.secrets, fetch: network.fetch })
  const meterDeps = {
    record: recordCall,
    recordContent: () => cfg().ai.callLog.recordContent,
    onError: (err: unknown) => log.warn('model call not recorded', err),
  }
  const lowEffortModel = async (selection: ModelSelection | undefined): Promise<ModelClient> => {
    const client = await lowEffort(selection)
    const provider = cfg().ai.providers.find((p) => p.id === client.ref.providerId)
    const secret = provider?.apiKeyRef ? (deps.secrets.reveal(provider.apiKeyRef) ?? undefined) : undefined
    return meterModelClient(
      client,
      { feature: 'memory', providerId: client.ref.providerId, secrets: [secret] },
      meterDeps,
    )
  }

  const modelOps: ModelOps = { usage, network, fetchFor, testProxy, lowEffortModel }
  return { models, modelOps }
}
