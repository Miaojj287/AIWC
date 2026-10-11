/**
 * Ollama model metadata (POST /api/show): the trained context length and the capability list (`tools`, `vision`,
 * `thinking`). Used by discovery to fill 智能配置 for local models. Loopback only, so no proxy and no key.
 */
const SHOW_TIMEOUT_MS = 5_000
const SHOW_CONCURRENCY = 4
/** A pulled-model list can be long; metadata beyond this many models is left to the profile heuristics. */
const SHOW_MAX_MODELS = 64

export interface OllamaShow {
  contextLength?: number
  capabilities: string[]
}

type Row = Record<string, unknown>
const record = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}

/** Parse a /api/show body. `<arch>.context_length` sits in model_info under the architecture's own prefix. */
export function parseOllamaShow(body: unknown): OllamaShow {
  const root = record(body)
  const info = record(root.model_info)
  const arch = typeof info['general.architecture'] === 'string' ? info['general.architecture'] : undefined
  const direct = arch ? info[`${arch}.context_length`] : undefined
  const fallback = Object.entries(info).find(([key]) => key.endsWith('.context_length'))?.[1]
  const length = typeof direct === 'number' ? direct : fallback
  const capabilities = Array.isArray(root.capabilities)
    ? root.capabilities.filter((c): c is string => typeof c === 'string')
    : []
  return {
    contextLength: typeof length === 'number' && Number.isInteger(length) && length > 0 ? length : undefined,
    capabilities,
  }
}

/** /api/show for each model (bounded concurrency); a model whose metadata cannot be read is simply absent. */
export async function showOllamaModels(
  rootUrl: string,
  modelIds: readonly string[],
  doFetch: typeof fetch,
  signal?: AbortSignal,
): Promise<Map<string, OllamaShow>> {
  const result = new Map<string, OllamaShow>()
  const queue = modelIds.slice(0, SHOW_MAX_MODELS)
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const timeout = AbortSignal.timeout(SHOW_TIMEOUT_MS)
      try {
        const res = await doFetch(`${rootUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: id }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        })
        if (res.ok) result.set(id, parseOllamaShow(await res.json()))
      } catch {
        // Best effort: an old Ollama without /api/show, or a model being deleted, leaves the profile heuristics.
        if (signal?.aborted) return
      }
    }
  }
  await Promise.all(Array.from({ length: SHOW_CONCURRENCY }, worker))
  return result
}
