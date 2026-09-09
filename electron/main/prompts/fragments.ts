/**
 * Host-contributed context fragments (docs/ARCHITECTURE.md §5): every injection is a bounded,
 * marker-tagged ContextFragment. The kernel truncates to tokenCap before recording.
 */
import type { ContextFragment, MemoryStore } from '@aiwc/protocol'
import type { FragmentProvider } from '@aiwc/kernel'
import type { MemoryFragmentProvider } from '@aiwc/memory'
import type { Gateway } from '@aiwc/gateway'

export const USER_INSTRUCTIONS_TOKEN_CAP = 2_000

/**
 * AGENTS.md = the user's standing rules for the agent. Turn tier (not stable) on purpose: edits in
 * 设置 › 记忆 apply on the very next turn instead of waiting for a new session.
 */
export function userInstructionsFragmentProvider(memory: Pick<MemoryStore, 'read'>): FragmentProvider {
  return {
    tier: 'turn',
    async provide() {
      let text = ''
      try {
        text = (await memory.read('AGENTS')).trim()
      } catch {
        return []
      }
      if (!text) return []
      const fragment: ContextFragment = {
        kind: 'user_instructions',
        marker: '<user_instructions>',
        tokenCap: USER_INSTRUCTIONS_TOKEN_CAP,
        render: () => `<user_instructions>\n以下是用户为你设定的规则（AGENTS.md），优先级高于默认行为：\n${text}\n</user_instructions>`,
      }
      return [fragment]
    },
  }
}

/**
 * The stable-tier memory snapshot is frozen per provider instance; without this wiring every thread
 * created after startup would keep reading the snapshot taken at launch. Each write to a memory file
 * (agent tools, 设置 › 记忆, diary backfill) invalidates it so the next new thread re-reads the store;
 * threads already running keep their frozen prefix (prompt-cache stability, ARCHITECTURE §5.2).
 */
export function wireMemoryInvalidation(memory: Pick<MemoryStore, 'subscribe'>, provider: Pick<MemoryFragmentProvider, 'invalidate'>): () => void {
  return memory.subscribe(() => provider.invalidate())
}

const isWeChatChannel = (channel: string): boolean => channel.startsWith('wechat-')

export type ObservedSource = { observed: Pick<Gateway['observed'], 'fragment' | 'take'> }

/**
 * Group messages that were not addressed to the bot are buffered by the gateway; when the bot is
 * finally addressed they are replayed as an API-only fragment (never as user turns). The buffer is
 * drained right after the snapshot is taken: the fragment is recorded into the thread's history, so
 * replaying the same chatter on the next addressed turn would only duplicate it.
 */
export function observedFragmentProvider(gateway: ObservedSource): FragmentProvider {
  return {
    tier: 'turn',
    async provide({ origin }) {
      if (!isWeChatChannel(origin.channel) || !origin.chatId) return []
      try {
        const fragment = gateway.observed.fragment(origin.chatId)
        if (!fragment) return []
        gateway.observed.take(origin.chatId)
        return [fragment]
      } catch {
        return []
      }
    },
  }
}
