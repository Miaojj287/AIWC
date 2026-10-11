/**
 * IPC channels for model providers, proxy, usage and call logs. Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 */
import type { ModelCallDetail, ModelCallRecord, ModelUsageFeature, UsageSummary } from '../modelUsage'

/** Result of 测试代理: one request through the current network settings. */
export interface ProxyTestResult {
  ok: boolean
  /** How the request was routed (bypass rules and loopback go direct). */
  route: 'direct' | 'proxy'
  /** `scheme://host:port` of the proxy used; never carries credentials. */
  proxy?: string
  latencyMs?: number
  httpStatus?: number
  /** Stable code: `proxy_invalid` / `timeout` / `network`; the UI picks the sentence. */
  errorCode?: 'proxy_invalid' | 'timeout' | 'network'
  /** Raw network error text (for the detail line). */
  detail?: string
}

/** Invoke channels (model providers, proxy, usage and call logs). */
export interface ModelsInvokeMap {
  /** Token / request totals for the last `days` days, by day, feature and model. */
  'models:usageSummary': { req: { days: number }; res: UsageSummary }
  /** 清空用量统计: daily roll-ups and the call log. */
  'models:clearUsage': { req: void; res: void }
  /** Newest first; `before` = the `at` of the last row already shown. */
  'models:listCalls': {
    req: { limit: number; before?: { at: number; id: string }; feature?: ModelUsageFeature }
    res: { items: ModelCallRecord[]; hasMore: boolean }
  }
  'models:getCall': { req: { id: string }; res: ModelCallDetail | null }
  /** 清空调用记录 (keeps the usage roll-ups). */
  'models:clearCalls': { req: void; res: void }
  /** Reach `url` (default: the endpoint of the default model) through the saved network settings. */
  'models:testProxy': { req: { url?: string }; res: ProxyTestResult }
}

/** Push events (model providers, proxy, usage and call logs). */
export interface ModelsEventMap {
  /** A model call finished and was recorded (metadata only); the usage page refreshes on it. */
  'models:callRecorded': ModelCallRecord
}

export const MODELS_INVOKE_CHANNELS = [
  'models:usageSummary',
  'models:clearUsage',
  'models:listCalls',
  'models:getCall',
  'models:clearCalls',
  'models:testProxy',
] as const satisfies readonly (keyof ModelsInvokeMap)[]
export const MODELS_EVENT_CHANNELS = ['models:callRecorded'] as const satisfies readonly (keyof ModelsEventMap)[]
