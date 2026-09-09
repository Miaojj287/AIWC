/**
 * ContextManager — append-only history with record-time truncation, prompt projection and usage
 * accounting (ARCHITECTURE §5). It never rewrites items; compaction appends a summary that folds a prefix.
 */
import {
  estimateTokens,
  type CompactionSummaryItem,
  type ContextUsage,
  type HistoryItem,
  type ItemId,
  type JsonValue,
  type ToolOutputContent,
  type ToolResultItem,
} from '@aiwc/protocol'
import { truncateChars } from '../util/truncate'

export const DEFAULT_TOOL_OUTPUT_CHARS = 16_000

/**
 * Usage breakdown (ARCHITECTURE §5.6): fragments whose kind starts with 'memory' or 'relationship' are memory
 * tokens; every other fragment (mentions, observed context, environment…) is a reference.
 */
export const isMemoryFragmentKind = (kind: string): boolean => kind.startsWith('memory') || kind.startsWith('relationship')

/**
 * Bounded stand-in for an image tool output. Raw base64 never reaches history (ARCHITECTURE §5.4): the
 * record-time cut replaces it with this JSON placeholder, and the model sees the same one-line description.
 */
export interface ImagePlaceholder {
  type: 'image'
  mediaType: string
  /** decoded size of the original payload */
  bytes: number
  /** optional handle (file path / artifact id) the UI can use to show the real image */
  ref?: string
}

/** The placeholder as it is stored: a plain JSON object (so it fits ToolOutputContent's json variant). */
export type ImagePlaceholderJson = ImagePlaceholder & { [k: string]: JsonValue }

const base64Bytes = (data: string): number => {
  const clean = data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

export function imagePlaceholder(mediaType: string, data: string, ref?: string): ImagePlaceholderJson {
  const bytes = base64Bytes(data)
  return ref ? { type: 'image', mediaType, bytes, ref } : { type: 'image', mediaType, bytes }
}

export function isImagePlaceholder(value: JsonValue | undefined): value is ImagePlaceholderJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return v.type === 'image' && typeof v.mediaType === 'string' && typeof v.bytes === 'number' && !('data' in v)
}

/** A tool that returned `{ type: 'image', mediaType, data }` as JSON is treated like a native image output. */
const isRawImageJson = (value: JsonValue): value is JsonValue & { type: 'image'; mediaType: string; data: string; ref?: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return v.type === 'image' && typeof v.mediaType === 'string' && typeof v.data === 'string'
}

/** Replace any raw image payload in a tool output with the bounded placeholder; other outputs pass through. */
export function boundToolOutput(output: ToolOutputContent): ToolOutputContent {
  if (output.type === 'image') return { type: 'json', value: imagePlaceholder(output.mediaType, output.data) }
  if (output.type === 'json' && isRawImageJson(output.value)) {
    return { type: 'json', value: imagePlaceholder(output.value.mediaType, output.value.data, typeof output.value.ref === 'string' ? output.value.ref : undefined) }
  }
  return output
}

export const renderImagePlaceholder = (p: ImagePlaceholder): string => `[图片结果 ${p.mediaType}，${p.bytes} 字节${p.ref ? `，${p.ref}` : ''}]`

export interface ContextManagerOptions {
  maxToolOutputChars?: number
  /** Called when history is rolled back so dependants (world-state baseline) can invalidate. */
  onInvalidate?: () => void
}

/** Per-call override of the record-time tool-output cap. */
export interface RecordOptions {
  /**
   * Cap for tool_result outputs in this batch. Pass Number.POSITIVE_INFINITY when the outputs were already
   * bounded upstream (the ToolRouter truncates to the tool's own maxOutputChars at dispatch) so the generic
   * default does not cut a second time below a tool's declared budget.
   */
  maxOutputChars?: number
}

export interface UsageInput {
  systemTokens: number
  toolSpecTokens: number
  maxTokens: number
}

export function renderToolOutput(output: ToolOutputContent): string {
  switch (output.type) {
    case 'text':
      return output.text
    case 'json':
      return isImagePlaceholder(output.value) ? renderImagePlaceholder(output.value) : JSON.stringify(output.value)
    case 'image':
      return renderImagePlaceholder(imagePlaceholder(output.mediaType, output.data))
  }
}

/** Token estimate of a single item (what the model would see). */
export function estimateItemTokens(item: HistoryItem): number {
  switch (item.type) {
    case 'user_message':
      return item.content.reduce((n, p) => n + (p.type === 'text' ? estimateTokens(p.text) : 1200), 0)
    case 'assistant_message':
      return estimateTokens(item.text) + (item.reasoning ? estimateTokens(item.reasoning) : 0)
    case 'tool_call':
      return estimateTokens(item.toolName) + estimateTokens(JSON.stringify(item.input)) + 8
    case 'tool_result':
      return estimateTokens(renderToolOutput(item.output)) + 8
    case 'context_fragment':
      return item.tokenEstimate
    case 'compaction_summary':
      return item.tokenEstimate
    case 'turn_aborted':
      return 12
  }
}

export class ContextManager {
  private items: HistoryItem[] = []
  private tokenCache = new Map<ItemId, number>()
  private _version = 0
  private readonly maxToolOutputChars: number
  private readonly onInvalidate: (() => void) | undefined

  constructor(initial: readonly HistoryItem[] = [], opts: ContextManagerOptions = {}) {
    this.maxToolOutputChars = opts.maxToolOutputChars ?? DEFAULT_TOOL_OUTPUT_CHARS
    this.onInvalidate = opts.onInvalidate
    for (const it of initial) this.items.push(it)
  }

  get version(): number {
    return this._version
  }

  all(): readonly HistoryItem[] {
    return this.items
  }

  get length(): number {
    return this.items.length
  }

  /**
   * Append items. Tool outputs are truncated at record time to `opts.maxOutputChars` (default: this manager's
   * cap) and image payloads are replaced by a bounded placeholder; fragments keep their own tokenEstimate.
   */
  recordItems(items: readonly HistoryItem[], opts?: RecordOptions): HistoryItem[] {
    const recorded: HistoryItem[] = []
    for (const raw of items) {
      const item = raw.type === 'tool_result' ? this.truncateResult(raw, opts?.maxOutputChars) : raw
      this.items.push(item)
      recorded.push(item)
    }
    if (recorded.length > 0) this._version++
    return recorded
  }

  private truncateResult(item: ToolResultItem, maxOutputChars?: number): ToolResultItem {
    const cap = maxOutputChars ?? this.maxToolOutputChars
    const output = boundToolOutput(item.output)
    const bounded = output === item.output ? item : { ...item, output }
    if (output.type === 'json' && isImagePlaceholder(output.value)) return bounded
    const text = renderToolOutput(output)
    if (text.length <= cap) return bounded
    const cut = truncateChars(text, cap)
    return { ...bounded, output: { type: 'text', text: cut.text }, truncated: true }
  }

  tokensOf(item: HistoryItem): number {
    const cached = this.tokenCache.get(item.id)
    if (cached !== undefined) return cached
    const n = estimateItemTokens(item)
    this.tokenCache.set(item.id, n)
    return n
  }

  lastCompaction(): CompactionSummaryItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!
      if (it.type === 'compaction_summary') return it
    }
    return undefined
  }

  /**
   * Model-visible projection: the latest compaction summary first, then every non-summary item recorded
   * after the folded-through anchor; orphan tool calls / results are dropped.
   */
  forPrompt(): HistoryItem[] {
    const summary = this.lastCompaction()
    let out: HistoryItem[]
    if (!summary) {
      out = this.items.filter((it) => it.type !== 'compaction_summary')
    } else {
      const anchor = this.items.findIndex((it) => it.id === summary.foldedThroughId)
      const tail = this.items.slice(anchor + 1).filter((it) => it.type !== 'compaction_summary')
      out = [summary, ...tail]
    }
    return dropOrphans(out)
  }

  /** Tokens of the model-visible history (excluding system prompt and tool specs). */
  historyTokens(): number {
    return this.forPrompt().reduce((n, it) => n + this.tokensOf(it), 0)
  }

  usage(input: UsageInput): ContextUsage {
    let memory = 0
    let references = 0
    let history = 0
    for (const it of this.forPrompt()) {
      const t = this.tokensOf(it)
      if (it.type === 'context_fragment') {
        if (isMemoryFragmentKind(it.kind)) memory += t
        else references += t
      } else history += t
    }
    const used = input.systemTokens + input.toolSpecTokens + memory + references + history
    return {
      usedTokens: used,
      maxTokens: input.maxTokens,
      breakdown: { system: input.systemTokens, memory, references, history, tools: input.toolSpecTokens },
    }
  }

  /** Remove the last `n` user turns (user_message and everything after it). Returns the removed items. */
  dropLastNUserTurns(n: number): HistoryItem[] {
    if (n <= 0) return []
    let cut = -1
    let seen = 0
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i]!.type === 'user_message') {
        seen++
        if (seen === n) {
          cut = i
          break
        }
      }
    }
    if (cut < 0) cut = 0
    const removed = this.items.splice(cut)
    for (const r of removed) this.tokenCache.delete(r.id)
    this._version++
    this.onInvalidate?.()
    return removed
  }

  clear(): void {
    this.items = []
    this.tokenCache.clear()
    this._version++
    this.onInvalidate?.()
  }
}

/** Drop tool_call items without a result and tool_result items without a call (e.g. cut by compaction). */
export function dropOrphans(items: HistoryItem[]): HistoryItem[] {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const it of items) {
    if (it.type === 'tool_call') calls.add(it.callId)
    else if (it.type === 'tool_result') results.add(it.callId)
  }
  return items.filter((it) => {
    if (it.type === 'tool_call') return results.has(it.callId)
    if (it.type === 'tool_result') return calls.has(it.callId)
    return true
  })
}
