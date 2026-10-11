/**
 * Proxy-aware fetch for requests to model providers (设置 › AI 接入 › 网络). Each request is routed on its own:
 * loopback (Ollama, local servers) and the user's bypass rules go direct; otherwise the system proxy (resolved by
 * Chromium, so PAC files and OS settings apply), the manual proxy, or no proxy. A manual proxy that is invalid fails
 * the request instead of silently going direct. Only model traffic uses this transport; nothing else is re-routed.
 */
import { Buffer } from 'node:buffer'
import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { bypassesProxy, parseProxyUrl, proxyFromPacResult, type ProxyConfig } from '@aiwc/protocol'
import type { Logger } from '../log'
import { nullLogger } from '../log'

/** Chromium answers from its cache almost always; a PAC script that hangs must not hold the request. */
const SYSTEM_PROXY_TIMEOUT_MS = 3_000

export type ProxyRoute = { kind: 'direct' } | { kind: 'proxy'; proxyUrl: string } | { kind: 'invalid' }

export interface ProxyAuth {
  username: string
  password?: string
}

type DispatchingFetch = (
  url: string,
  init: Omit<RequestInit, 'dispatcher'> & { dispatcher: Dispatcher },
) => Promise<Response>

export interface ModelFetchDeps {
  proxy: () => ProxyConfig
  /** Manual proxy password from the secret store. */
  password: () => string | undefined
  /** Electron `session.resolveProxy` (system mode): `PROXY host:port; DIRECT`. */
  resolveSystemProxy: (url: string) => Promise<string>
  logger?: Logger
  /** Test seams. */
  directFetch?: typeof fetch
  dispatchingFetch?: DispatchingFetch
  createDispatcher?: (proxyUrl: string, auth?: ProxyAuth) => Dispatcher
}

export interface ModelFetch {
  readonly fetch: typeof fetch
  route(url: string): Promise<ProxyRoute>
  /** Drop pooled proxy connections (network settings changed). */
  reset(): void
  dispose(): Promise<void>
}

/** Thrown when the manual proxy URL cannot be used; `code` lets callers say so without parsing text. */
export class ProxyConfigError extends Error {
  readonly code = 'proxy_invalid' as const
  constructor() {
    super('The configured proxy address is invalid')
    this.name = 'ProxyConfigError'
  }
}

export function createProxyDispatcher(proxyUrl: string, auth?: ProxyAuth): Dispatcher {
  const url = new URL(proxyUrl)
  if (url.protocol === 'socks5:' || url.protocol === 'socks5h:') {
    // undici resolves through the proxy with the domain name either way; it only accepts the socks5: spelling.
    return new Socks5ProxyAgent(`socks5://${url.host}`, {
      ...(auth ? { username: auth.username, password: auth.password ?? '' } : {}),
    })
  }
  const token = auth ? `Basic ${Buffer.from(`${auth.username}:${auth.password ?? ''}`).toString('base64')}` : undefined
  return new ProxyAgent({ uri: proxyUrl, ...(token ? { token } : {}) })
}

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

export function createModelFetch(deps: ModelFetchDeps): ModelFetch {
  const log = (deps.logger ?? nullLogger).child('model-fetch')
  const directFetch = deps.directFetch ?? globalThis.fetch
  // undici's fetch takes its own RequestInit type; the global one is the same shape at runtime (Node's fetch is undici).
  const dispatchingFetch: DispatchingFetch =
    deps.dispatchingFetch ??
    ((url, init) =>
      undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as Promise<unknown> as Promise<Response>)
  const createDispatcher = deps.createDispatcher ?? createProxyDispatcher
  const dispatchers = new Map<string, Dispatcher>()

  async function route(url: string): Promise<ProxyRoute> {
    const cfg = deps.proxy()
    if (cfg.mode === 'off' || bypassesProxy(url, cfg.bypass)) return { kind: 'direct' }
    if (cfg.mode === 'manual') {
      const parsed = parseProxyUrl(cfg.url)
      return parsed.ok ? { kind: 'proxy', proxyUrl: parsed.normalized } : { kind: 'invalid' }
    }
    try {
      const answer = await withTimeout(deps.resolveSystemProxy(url), SYSTEM_PROXY_TIMEOUT_MS)
      const proxy = proxyFromPacResult(answer)
      const parsed = proxy ? parseProxyUrl(proxy) : undefined
      return parsed?.ok ? { kind: 'proxy', proxyUrl: parsed.normalized } : { kind: 'direct' }
    } catch (err) {
      // The OS gave no answer: a direct connection is what every other app does in this state.
      log.debug('system proxy lookup failed; connecting directly', err)
      return { kind: 'direct' }
    }
  }

  function dispatcherFor(proxyUrl: string): Dispatcher {
    const cfg = deps.proxy()
    const auth =
      cfg.mode === 'manual' && cfg.username ? { username: cfg.username, password: deps.password() } : undefined
    const key = `${proxyUrl}\u0000${auth?.username ?? ''}`
    let dispatcher = dispatchers.get(key)
    if (!dispatcher) {
      dispatcher = createDispatcher(proxyUrl, auth)
      dispatchers.set(key, dispatcher)
    }
    return dispatcher
  }

  const modelFetch: typeof fetch = async (input, init) => {
    const url = urlOf(input)
    const target = await route(url)
    if (target.kind === 'invalid') throw new ProxyConfigError()
    if (target.kind === 'direct') return directFetch(input, init)
    return dispatchingFetch(url, { ...init, dispatcher: dispatcherFor(target.proxyUrl) })
  }

  function closeAll(): Promise<void> {
    const pending = [...dispatchers.values()].map((d) =>
      d.close().catch((err: unknown) => log.debug('proxy dispatcher close failed', err)),
    )
    dispatchers.clear()
    return Promise.all(pending).then(() => undefined)
  }

  return {
    fetch: modelFetch,
    route,
    reset: () => void closeAll(),
    dispose: closeAll,
  }
}
