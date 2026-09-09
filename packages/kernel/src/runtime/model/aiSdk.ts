import { modelCapabilities, validModelSettings } from '@aiwc/protocol'
/**
 * AI SDK v7 adapter. One sample() = one streamText call with tools passed WITHOUT execute, so every tool
 * call comes back to the kernel (the default stopWhen is one step, which is exactly what we want).
 */
import type { FinishReason, ModelClient, ModelEntry, ProviderConfig, SamplingPart, SamplingRequest, TokenUsage, ToolSpecForModel } from '@aiwc/protocol'
import { jsonSchema, streamText, tool, type JSONSchema7, type ModelMessage, type ToolSet } from 'ai'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>
type ProviderOptionValues = ProviderOptions[string]
import { isAbortError, toModelError } from './errors'
import { historyToModelMessages } from './messages'
import { createLanguageModel, toModelRef } from './providers'

export interface AiSdkModelClientInput {
  provider: ProviderConfig
  model: ModelEntry
  apiKey?: string
}

export function specsToToolSet(specs: readonly ToolSpecForModel[]): ToolSet {
  const set: ToolSet = {}
  for (const spec of specs) {
    set[spec.name] = tool({ description: spec.description, inputSchema: jsonSchema(spec.inputJsonSchema as JSONSchema7) })
  }
  return set
}

export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'tool-calls':
      return 'tool_calls'
    case 'length':
      return 'length'
    case 'content-filter':
      return 'content_filter'
    case 'error':
      return 'error'
    default:
      return 'other'
  }
}

interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}

export function mapUsage(u: UsageLike | undefined): TokenUsage {
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    cachedInputTokens: u?.inputTokenDetails?.cacheReadTokens,
    reasoningTokens: u?.outputTokenDetails?.reasoningTokens,
  }
}

/** UI and runtime share the same capability contract; stale unsupported settings are omitted. */
export function providerOptionsFor(provider: Pick<ProviderConfig, 'kind' | 'id'>, model: Pick<ModelEntry, 'modelId' | 'capabilities' | 'reasoningEffort' | 'thinkingBudget' | 'fast'>): ProviderOptions | undefined {
  const c = modelCapabilities(provider, model)
  const effort = model.reasoningEffort && c.reasoning.includes(model.reasoningEffort) ? model.reasoningEffort : undefined
  const fast = c.fast && model.fast === true
  const budget = c.thinking === 'budget' && model.thinkingBudget !== undefined
    ? Math.max(c.thinkingBudgetMin ?? 0, Math.min(model.thinkingBudget, c.thinkingBudgetMax ?? model.thinkingBudget)) : undefined
  if (!effort && !fast && budget === undefined) return undefined
  switch (provider.kind) {
    case 'openai': return effort ? { openai: { reasoningEffort: effort === 'off' ? 'none' : effort } } : undefined
    case 'anthropic': {
      const anthropic: ProviderOptionValues = {}
      if (effort) {
        anthropic.effort = effort
        if (c.thinking === 'adaptive') anthropic.thinking = { type: 'adaptive' }
      }
      if (budget !== undefined) anthropic.thinking = budget === 0 ? { type: 'disabled' } : { type: 'enabled', budgetTokens: budget }
      if (fast) anthropic.speed = 'fast'
      return { anthropic }
    }
    case 'google': return { google: { thinkingConfig: budget !== undefined ? { thinkingBudget: budget } : { thinkingLevel: effort } } }
    default: return undefined
  }
}

export function createAiSdkModelClient(input: AiSdkModelClientInput): ModelClient {
  const settings = validModelSettings(input.provider, input.model)
  const capabilities = modelCapabilities(input.provider, settings)
  const ref = toModelRef(input.provider, settings)
  const languageModel = createLanguageModel(input.provider, input.model.modelId, input.apiKey)
  const providerOptions = providerOptionsFor(input.provider, input.model)

  async function* sample(req: SamplingRequest): AsyncIterable<SamplingPart> {
    const messages: ModelMessage[] = historyToModelMessages(req.history)
    const tools = req.tools.length > 0 && ref.supportsTools ? specsToToolSet(req.tools) : undefined
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let finishReason: FinishReason | undefined
    let sawToolCall = false
    try {
      const result = streamText({
        model: languageModel,
        system: req.system,
        messages,
        tools,
        toolChoice: tools ? req.toolChoice : undefined,
        maxOutputTokens: req.maxOutputTokens !== undefined || ref.maxOutputTokens !== undefined ? Math.min(req.maxOutputTokens ?? ref.maxOutputTokens!, capabilities.outputLimit ?? Infinity) : undefined,
        temperature: capabilities.temperature && !(input.provider.kind === 'anthropic' && capabilities.thinking === 'budget' && settings.thinkingBudget !== undefined && settings.thinkingBudget > 0) ? req.temperature ?? settings.temperature : undefined,
        providerOptions: input.provider.kind === 'openai' ? { ...providerOptions, openai: { store: false, ...providerOptions?.openai } } : providerOptions,
        abortSignal: req.signal,
        maxRetries: 1,
        // TODO(cache): req.cacheKey is stable per thread; wire provider prompt caching (Anthropic cache_control on
        // the system prompt) once the provider option shape is confirmed against the installed @ai-sdk/anthropic.
      })
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            if (part.text) yield { type: 'text.delta', delta: part.text }
            break
          case 'reasoning-delta':
            if (part.text) yield { type: 'reasoning.delta', delta: part.text }
            break
          case 'tool-call':
            sawToolCall = true
            yield { type: 'tool_call', callId: part.toolCallId, name: part.toolName, input: part.input }
            break
          case 'finish-step':
            usage = mapUsage(part.usage)
            finishReason = mapFinishReason(part.finishReason)
            break
          case 'finish':
            usage = mapUsage(part.totalUsage)
            finishReason = finishReason ?? mapFinishReason(part.finishReason)
            break
          case 'abort':
            finishReason = 'aborted'
            break
          case 'error':
            if (isAbortError(part.error) || req.signal.aborted) {
              finishReason = 'aborted'
              break
            }
            yield { type: 'error', error: toModelError(part.error) }
            return
          default:
            break
        }
      }
    } catch (err) {
      if (isAbortError(err) || req.signal.aborted) {
        yield { type: 'finish', reason: 'aborted', usage }
        return
      }
      yield { type: 'error', error: toModelError(err) }
      return
    }
    if (req.signal.aborted) finishReason = 'aborted'
    yield { type: 'finish', reason: finishReason ?? (sawToolCall ? 'tool_calls' : 'stop'), usage }
  }

  return { ref, sample }
}
