/**
 * Three-tier system prompt (ARCHITECTURE §5.2):
 *   stable   — identity + rules + skills index + 'stable' tier fragments (memory snapshot). Computed ONCE per
 *              thread lifetime and frozen so provider prompt caching works for the whole session. When a
 *              stable provider throws, the degraded (memory-less) prompt is used for that turn but NOT frozen:
 *              the tier is rebuilt on the next turn, up to STABLE_BUILD_MAX_ATTEMPTS, then frozen as is.
 *   context  — thread origin / channel, @mentions of the current turn.
 *   volatile — date (to the day) and the context-usage line.
 */
import { estimateTokens, type ContextFragment, type Mention, type ThreadId, type ThreadOrigin, type ThreadSettings } from '@aiwc/protocol'
import type { FragmentProvider, SkillIndex } from '../ports'
import { renderFragment } from './context/fragments/base'
import { dayString } from './context/fragments/environment'
import { fnv1a64 } from './util/hash'

export interface StablePrompt {
  readonly text: string
  readonly tokens: number
  readonly cacheKey: string
}

export interface PromptBuilderDeps {
  stable: string
  skills: SkillIndex
  fragmentProviders: readonly FragmentProvider[]
  /** false for threads that may not run tools (persona): the index would advertise skills it cannot use. */
  includeSkills?: boolean
  onError?: (err: unknown) => void
}

/** Builds of the stable tier attempted while a stable provider keeps failing, before freezing regardless. */
export const STABLE_BUILD_MAX_ATTEMPTS = 3

export interface BuildPromptInput {
  threadId: ThreadId
  origin: ThreadOrigin
  settings: ThreadSettings
  userText: string
  mentions: readonly Mention[]
  date: Date
  usage?: { usedTokens: number; maxTokens: number }
}

export interface BuiltPrompt {
  system: string
  cacheKey: string
  tokens: number
  stableTokens: number
}

const CHANNEL_LABEL: Record<string, string> = {
  desktop: '桌面工作台',
  'wechat-ilink': '微信（iLink 机器人）',
  'wechat-ui': '微信（界面注入）',
  cron: '定时任务',
  observed: '观察流',
}

const MENTION_LABEL: Record<Mention['kind'], string> = { session: '会话', file: '文件', contact: '联系人', memory: '记忆' }

function renderMany(fragments: readonly ContextFragment[], onError?: (e: unknown) => void): string[] {
  const out: string[] = []
  for (const f of fragments) {
    try {
      const r = renderFragment(f)
      if (r.text.slice(r.marker.length).trim()) out.push(r.text)
    } catch (err) {
      onError?.(err)
    }
  }
  return out
}

export class PromptBuilder {
  private stableCache: Promise<StablePrompt> | undefined
  private stableAttempts = 0

  constructor(private readonly deps: PromptBuilderDeps) {}

  /** How many times the stable tier has been built for this thread (tests / diagnostics). */
  get stableBuildAttempts(): number {
    return this.stableAttempts
  }

  /**
   * Stable tier: computed once, then frozen for the thread's lifetime. A build during which a stable provider
   * threw is served to concurrent callers but dropped from the cache so the next turn retries; after
   * STABLE_BUILD_MAX_ATTEMPTS failed builds the degraded prompt is frozen and the failure logged once more.
   */
  stablePrompt(ctx: Pick<BuildPromptInput, 'threadId' | 'origin' | 'settings'>): Promise<StablePrompt> {
    if (!this.stableCache) {
      this.stableAttempts++
      const attempt = this.stableAttempts
      const job = this.computeStable(ctx).then(({ prompt, failed }) => {
        if (failed && attempt < STABLE_BUILD_MAX_ATTEMPTS) {
          if (this.stableCache === job) this.stableCache = undefined
          this.deps.onError?.(new Error(`stable prompt degraded (attempt ${attempt}/${STABLE_BUILD_MAX_ATTEMPTS}); retrying next turn`))
        } else if (failed) {
          this.deps.onError?.(new Error(`stable prompt degraded after ${attempt} attempts; frozen without the failing provider`))
        }
        return prompt
      })
      this.stableCache = job
    }
    return this.stableCache
  }

  private async computeStable(ctx: Pick<BuildPromptInput, 'threadId' | 'origin' | 'settings'>): Promise<{ prompt: StablePrompt; failed: boolean }> {
    const parts: string[] = [this.deps.stable.trim()]
    let failed = false
    if (this.deps.includeSkills !== false) {
      try {
        const skills = renderMany([this.deps.skills.indexFragment()], this.deps.onError)
        parts.push(...skills)
      } catch (err) {
        this.deps.onError?.(err)
      }
    }
    for (const provider of this.deps.fragmentProviders) {
      if (provider.tier !== 'stable') continue
      try {
        const fragments = await provider.provide({ threadId: ctx.threadId, origin: ctx.origin, settings: ctx.settings, userText: '' })
        parts.push(...renderMany(fragments, this.deps.onError))
      } catch (err) {
        failed = true
        this.deps.onError?.(err)
      }
    }
    const text = parts.filter(Boolean).join('\n\n')
    return { prompt: Object.freeze({ text, tokens: estimateTokens(text), cacheKey: fnv1a64(text) }), failed }
  }

  renderContextTier(input: Pick<BuildPromptInput, 'origin' | 'mentions'>): string {
    const lines: string[] = ['<context>']
    const channel = CHANNEL_LABEL[input.origin.channel] ?? input.origin.channel
    lines.push(input.origin.chatId ? `线程来源：${channel}，会话 ${input.origin.chatId}` : `线程来源：${channel}`)
    if (input.origin.channel !== 'desktop' && input.origin.chatId) {
      lines.push('该线程绑定到来源会话：任何发送类操作只能发回这个会话。')
    }
    if (input.mentions.length > 0) {
      const seen = new Set<string>()
      const labels: string[] = []
      for (const m of input.mentions) {
        const key = `${m.kind}:${m.id}`
        if (seen.has(key)) continue
        seen.add(key)
        labels.push(`@${MENTION_LABEL[m.kind]}「${m.label}」`)
      }
      lines.push(`本轮引用：${labels.join('，')}`)
    }
    return lines.join('\n')
  }

  renderVolatileTier(input: Pick<BuildPromptInput, 'date' | 'usage'>): string {
    const lines: string[] = ['<volatile>', `日期：${dayString(input.date)}`]
    if (input.usage && input.usage.maxTokens > 0) {
      const pct = Math.min(100, Math.round((input.usage.usedTokens / input.usage.maxTokens) * 100))
      lines.push(`上下文占用：${input.usage.usedTokens.toLocaleString('en-US')} / ${input.usage.maxTokens.toLocaleString('en-US')} tokens（${pct}%）`)
    }
    return lines.join('\n')
  }

  async build(input: BuildPromptInput): Promise<BuiltPrompt> {
    const stable = await this.stablePrompt(input)
    const context = this.renderContextTier(input)
    const volatile = this.renderVolatileTier(input)
    const system = [stable.text, context, volatile].join('\n\n')
    return { system, cacheKey: stable.cacheKey, tokens: estimateTokens(system), stableTokens: stable.tokens }
  }
}
