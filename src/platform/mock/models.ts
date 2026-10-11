/**
 * models:* for the mock bridge (tests + browser previews): an in-memory call log seeded with a few calls so the
 * 用量与记录 page has something to draw, the same roll-up rules as usage.db, and a scripted proxy test.
 */
import {
  MODEL_USAGE_FEATURES,
  type ModelCallDetail,
  type ModelCallRecord,
  type ModelUsageFeature,
  type UsageSummary,
  type UsageTotals,
} from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const DAY_MS = 86_400_000
const SEED_CALLS = 24

const dayOf = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const empty = (): UsageTotals => ({
  requests: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
})
function add(into: UsageTotals, call: ModelCallRecord): void {
  into.requests += 1
  into.errors += call.status === 'error' ? 1 : 0
  into.inputTokens += call.inputTokens
  into.outputTokens += call.outputTokens
  into.cachedInputTokens += call.cachedInputTokens ?? 0
  into.reasoningTokens += call.reasoningTokens ?? 0
}

export function modelsHandlers(ctx: MockContext): HandlersFor<'models'> {
  const calls: ModelCallDetail[] = []
  const seedFeatures: ModelUsageFeature[] = ['agent', 'agent', 'autoReply', 'title', 'todo', 'clone', 'task']
  for (let i = 0; i < SEED_CALLS; i++) {
    const feature = seedFeatures[i % seedFeatures.length] ?? 'agent'
    const failed = i % 11 === 5
    calls.push({
      id: `call_${i}`,
      at: ctx.now() - i * 0.4 * DAY_MS - 60_000,
      feature,
      providerId: i % 3 === 0 ? 'ollama' : 'deepseek',
      modelId: i % 3 === 0 ? 'qwen3:8b' : 'deepseek-chat',
      local: i % 3 === 0,
      inputTokens: failed ? 0 : 800 + ((i * 937) % 4000),
      outputTokens: failed ? 0 : 60 + ((i * 131) % 600),
      latencyMs: 600 + ((i * 271) % 4000),
      firstTokenMs: failed ? undefined : 300 + ((i * 53) % 700),
      status: failed ? 'error' : 'ok',
      errorCode: failed ? 'rate_limit' : undefined,
      httpStatus: failed ? 429 : undefined,
      errorMessage: failed ? 'Rate limit reached' : undefined,
      hasContent: false,
    })
  }

  const meta = ({ request: _q, response: _r, errorMessage: _e, ...rest }: ModelCallDetail): ModelCallRecord => rest

  return {
    'models:usageSummary': async ({ days }) => {
      const to = startOfDay(ctx.now()) + DAY_MS
      const from = startOfDay(to - days * DAY_MS)
      const inRange = calls.filter((c) => c.at >= from && c.at < to)
      const totals = empty()
      const byDay = new Map<string, UsageTotals>()
      const byFeature = new Map<ModelUsageFeature, UsageTotals>()
      const byModel = new Map<string, UsageTotals & { providerId: string; modelId: string; local: boolean }>()
      for (const c of inRange) {
        add(totals, c)
        add(byDay.get(dayOf(c.at)) ?? byDay.set(dayOf(c.at), empty()).get(dayOf(c.at))!, c)
        add(byFeature.get(c.feature) ?? byFeature.set(c.feature, empty()).get(c.feature)!, c)
        const key = `${c.providerId}::${c.modelId}`
        if (!byModel.has(key))
          byModel.set(key, { providerId: c.providerId, modelId: c.modelId, local: c.local, ...empty() })
        add(byModel.get(key)!, c)
      }
      const dayList: UsageSummary['days'] = []
      for (let t = from; t < to; t = startOfDay(t + DAY_MS * 1.5))
        dayList.push({ day: dayOf(t), ...(byDay.get(dayOf(t)) ?? empty()) })
      const weight = (x: UsageTotals) => x.inputTokens + x.outputTokens
      return {
        from,
        to,
        totals,
        days: dayList,
        byFeature: [...byFeature]
          .map(([feature, t]) => ({ feature, ...t }))
          .sort(
            (a, b) =>
              weight(b) - weight(a) ||
              MODEL_USAGE_FEATURES.indexOf(a.feature) - MODEL_USAGE_FEATURES.indexOf(b.feature),
          ),
        byModel: [...byModel.values()].sort((a, b) => weight(b) - weight(a)),
      }
    },
    'models:clearUsage': async () => {
      calls.length = 0
    },
    'models:listCalls': async ({ limit, before, feature }) => {
      const sorted = [...calls]
        .filter((c) => !feature || c.feature === feature)
        .filter((c) => !before || c.at < before.at || (c.at === before.at && c.id < before.id))
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
      return { items: sorted.slice(0, limit).map(meta), hasMore: sorted.length > limit }
    },
    'models:getCall': async ({ id }) => calls.find((c) => c.id === id) ?? null,
    'models:clearCalls': async () => {
      calls.length = 0
    },
    'models:testProxy': async () => {
      await ctx.delay(500)
      const proxy = ctx.config().ai.proxy
      if (proxy.mode === 'off') return { ok: true, route: 'direct', latencyMs: 180, httpStatus: 401 }
      return { ok: true, route: 'proxy', proxy: proxy.url ?? 'http://127.0.0.1:7890', latencyMs: 240, httpStatus: 401 }
    },
  }
}
