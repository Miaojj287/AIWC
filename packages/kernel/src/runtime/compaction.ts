/**
 * Compaction — the single strategy (ARCHITECTURE §5.1/§5.6). Triggered when usage exceeds
 * threshold × contextWindow (pre-turn and after each step) or manually. The tail (last complete user turn(s),
 * up to 30% of the window) is kept verbatim; everything before it is summarised by the auxiliary model into
 * ONE compaction_summary item that forPrompt() places first.
 */
import {
  estimateTokens,
  newItemId,
  newTurnId,
  type CompactionSummaryItem,
  type ContextUsage,
  type HistoryItem,
  type ModelClient,
  type ThreadId,
  type UserMessageItem,
} from '@aiwc/protocol'
import type { HookRunner, ModelResolver, RolloutLine } from '../ports'
import { renderToolOutput, type ContextManager } from './context/manager'
import type { Emitter } from './emitter'
import type { Logger } from './types'

export const COMPACTION_TAIL_RATIO = 0.3
const TRANSCRIPT_CHAR_CAP = 40_000
const PER_ITEM_CHAR_CAP = 2_000

export const COMPACTION_SYSTEM_PROMPT = [
  '你在压缩一段长对话的早期历史，供后续轮次作为背景继续使用。目标是「不丢关键信息」地缩短它。',
  '必须保留：',
  '1. 用户的目标、身份、偏好与长期诉求；',
  '2. 已达成的决定与承诺；',
  '3. 证据锚点：出现过的会话 ID（sessionId）、消息 ID（messageId）、联系人 wxid、时间与数字，原样保留；',
  '4. 未完成的任务与待办；',
  '5. 出现过的文件路径与产物位置。',
  '可以丢弃：寒暄、重复、过程性试错、冗长的工具原始输出。',
  '输出简洁的中文要点（可分小标题/列表），只基于给定内容，不要编造，不要复述本提示。',
].join('\n')

export function shouldCompact(usage: ContextUsage, threshold: number): boolean {
  if (usage.maxTokens <= 0) return false
  return usage.usedTokens > threshold * usage.maxTokens
}

export interface CompactionSplit {
  prefix: HistoryItem[]
  tail: HistoryItem[]
}

/**
 * Tail = the last complete user turn(s) whose total stays within 30% of the window. The most recent user
 * turn is always kept even when it alone exceeds the budget.
 */
export function selectCompactionSplit(items: readonly HistoryItem[], tokensOf: (i: HistoryItem) => number, contextWindow: number): CompactionSplit | undefined {
  const budget = Math.floor(contextWindow * COMPACTION_TAIL_RATIO)
  const userIdx: number[] = []
  items.forEach((it, i) => {
    if (it.type === 'user_message') userIdx.push(i)
  })
  if (userIdx.length === 0) return undefined
  let start = userIdx[userIdx.length - 1]!
  let tokens = 0
  for (let i = items.length - 1; i >= start; i--) tokens += tokensOf(items[i]!)
  for (let k = userIdx.length - 2; k >= 0; k--) {
    const candidate = userIdx[k]!
    let extra = 0
    for (let i = candidate; i < start; i++) extra += tokensOf(items[i]!)
    if (tokens + extra > budget) break
    tokens += extra
    start = candidate
  }
  const prefix = items.slice(0, start)
  const meaningful = prefix.filter((it) => it.type !== 'compaction_summary')
  if (meaningful.length === 0) return undefined
  return { prefix, tail: items.slice(start) }
}

function itemToTranscriptLine(item: HistoryItem): string {
  const cap = (s: string): string => (s.length > PER_ITEM_CHAR_CAP ? `${s.slice(0, PER_ITEM_CHAR_CAP)}…` : s)
  switch (item.type) {
    case 'user_message': {
      const text = item.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n')
      const mentions = item.mentions.length ? `（引用：${item.mentions.map((m) => `${m.kind}:${m.id}`).join(', ')}）` : ''
      return `用户：${cap(text)}${mentions}`
    }
    case 'assistant_message':
      return item.text ? `AI：${cap(item.text)}` : ''
    case 'tool_call':
      return `AI 调用工具 ${item.toolName}(${cap(JSON.stringify(item.input))})`
    case 'tool_result':
      return `工具 ${item.toolName} 返回${item.isError ? '错误' : ''}：${cap(renderToolOutput(item.output))}`
    case 'context_fragment':
      return item.kind === 'memory_snapshot' ? '' : `背景（${item.kind}）：${cap(item.text)}`
    case 'compaction_summary':
      return `前情摘要：${item.summary}`
    case 'turn_aborted':
      return `（上一轮中止：${item.reason}）`
  }
}

export function renderTranscript(items: readonly HistoryItem[]): string {
  const lines = items.map(itemToTranscriptLine).filter(Boolean)
  const text = lines.join('\n')
  return text.length > TRANSCRIPT_CHAR_CAP ? text.slice(text.length - TRANSCRIPT_CHAR_CAP) : text
}

export async function summarizeWithModel(model: ModelClient, transcript: string, signal?: AbortSignal): Promise<string> {
  const prompt: UserMessageItem = {
    type: 'user_message',
    id: newItemId(),
    turnId: newTurnId(),
    createdAt: Date.now(),
    content: [{ type: 'text', text: `需要压缩的对话历史：\n\n${transcript}` }],
    mentions: [],
  }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  let text = ''
  try {
    for await (const part of model.sample({ system: COMPACTION_SYSTEM_PROMPT, history: [prompt], tools: [], toolChoice: 'none', signal: controller.signal })) {
      if (part.type === 'text.delta') text += part.delta
      else if (part.type === 'error') throw Object.assign(new Error(part.error.message), { modelError: part.error })
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  // an interrupt that lands mid-summary must never record a partial summary; callers treat AbortError as interruption
  if (signal?.aborted) throw Object.assign(new Error('compaction aborted'), { name: 'AbortError' })
  const out = text.trim()
  if (!out) throw new Error('压缩摘要为空')
  return out
}

export interface CompactionDeps {
  models: ModelResolver
  hooks: HookRunner
  clock: () => number
  logger?: Logger
}

export interface CompactInput {
  threadId: ThreadId
  context: ContextManager
  contextWindow: number
  record: (items: HistoryItem[]) => HistoryItem[]
  persist: (line: RolloutLine) => void
  emit: Emitter['emit']
  signal?: AbortSignal
}

/** Runs one compaction. Resolves with the summary item, or undefined when there is nothing to fold. */
export async function compactContext(input: CompactInput, deps: CompactionDeps): Promise<CompactionSummaryItem | undefined> {
  const visible = input.context.forPrompt()
  const split = selectCompactionSplit(visible, (i) => input.context.tokensOf(i), input.contextWindow)
  if (!split) return undefined
  await deps.hooks.run('PreCompact', { threadId: input.threadId })
  const model = await deps.models.resolveAuxiliary()
  const summary = await summarizeWithModel(model, renderTranscript(split.prefix), input.signal)
  const prefixTokens = split.prefix.reduce((n, it) => n + input.context.tokensOf(it), 0)
  const last = split.prefix[split.prefix.length - 1]!
  const item: CompactionSummaryItem = {
    type: 'compaction_summary',
    id: newItemId(),
    createdAt: deps.clock(),
    summary,
    foldedItemCount: split.prefix.length,
    foldedThroughId: last.id,
    tokenEstimate: estimateTokens(summary),
  }
  input.record([item])
  input.persist({ ts: deps.clock(), type: 'compacted', summaryItemId: item.id, foldedThroughId: item.foldedThroughId })
  input.emit({ type: 'context.compacted', threadId: input.threadId, summaryItemId: item.id, freedTokens: Math.max(0, prefixTokens - item.tokenEstimate) })
  await deps.hooks.run('PostCompact', { threadId: input.threadId, text: summary })
  return item
}
