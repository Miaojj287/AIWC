/**
 * ReplyGate — the deterministic gate in front of the model (ARCHITECTURE §7).
 *
 * Nothing here calls a model or touches I/O: given a message and the matching rule it answers
 * "reply / observe / drop" with a stable reason code. Every check it performs is one the user can
 * see and undo in the UI — and there is only one such control left, the per-chat switch. A message
 * arriving in a chat whose rule is on always gets a reply.
 */
import type { AutoReplyRule, MessageEvent, ReplyDecision } from '@aiwc/protocol'

/** Stable reason codes carried in ReplyDecision.reason. */
export type ReplyReason =
  | 'ok'
  | 'self_sent'
  | 'kind_not_replyable'
  | 'internal'
  | 'no_rule'
  | 'rule_disabled'
  | 'rule_paused'

export interface ReplyGateDeps {
  /** Optional synchronous rule lookup used when decide() is called without an explicit rule. */
  rules?: (chatId: string) => AutoReplyRule | undefined
}

export interface ReplyGate {
  decide(event: MessageEvent, rule?: AutoReplyRule): ReplyDecision
}

/** Adapters mark the account owner's own messages either via raw.isSelf or by using the reserved peer id. */
export function isSelfSent(event: MessageEvent): boolean {
  if (event.source.peerId === 'me') return true
  const raw = event.raw as { isSelf?: unknown; is_self?: unknown } | undefined
  return raw?.isSelf === true || raw?.is_self === true
}

const NON_REPLYABLE_KINDS = new Set<MessageEvent['kind']>(['system', 'command'])

function observe(reason: ReplyReason, observe = true): ReplyDecision {
  return { reply: false, reason, observe }
}

export function createReplyGate(deps: ReplyGateDeps = {}): ReplyGate {
  const decide: ReplyGate['decide'] = (event, ruleArg) => {
    // Hard drops first: these never reply and never feed the observation buffer.
    if (isSelfSent(event)) return observe('self_sent', false)
    if (NON_REPLYABLE_KINDS.has(event.kind)) return observe('kind_not_replyable', false)
    if (event.internal) return observe('internal', false)

    const rule = ruleArg ?? deps.rules?.(event.source.chatId)
    if (!rule) return observe('no_rule')
    if (!rule.enabled) return observe('rule_disabled')
    if (rule.pausedReason) return observe('rule_paused')

    return { reply: true, reason: 'ok' satisfies ReplyReason }
  }

  return { decide }
}
