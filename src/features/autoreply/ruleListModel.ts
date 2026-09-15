/**
 * Rows of the 自动回复 object list (DESIGN-SPEC §3 左列). Every rule is listed — its chat is resolved on
 * its own, so a rule on the 1,000th chat stays reachable — and the chats without a rule follow from the
 * paged, server-searched session list in the substrate's order. Pure — tested in ruleListModel.test.ts.
 */
import type { AutoReplyRule, WxSession } from '@aiwc/protocol'
import { matchesSegment, ruleStatusLine, type RuleSegment } from './ruleModel'

export interface RuleRow {
  session: WxSession
  rule: AutoReplyRule | undefined
}

/** Only direct and group chats can carry a rule. */
export const isRuleTarget = (session: Pick<WxSession, 'kind'>): boolean =>
  session.kind === 'dm' || session.kind === 'group'

/** The fields substrate:listSessions searches (title, id, last preview), for chats resolved outside that query. */
export function sessionMatchesQuery(session: Pick<WxSession, 'id' | 'title' | 'lastPreview'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [session.title, session.id, session.lastPreview].some((field) => field?.toLowerCase().includes(q))
}

const STATUS_RANK = { on: 0, paused: 1, unset: 2 } as const

export interface RuleRowsInput {
  /** Every rule (autoreply:listRules), with any optimistic toggle already applied. */
  rules: readonly AutoReplyRule[]
  /** Chats behind the rules, resolved one by one (substrate:getSession). */
  ruleSessions: ReadonlyMap<string, WxSession>
  /** The loaded pages of substrate:listSessions for `query`, in substrate order. */
  pageSessions: readonly WxSession[]
  query: string
  segment: RuleSegment
  /** Replies parked for confirmation, per chat id. */
  parked: ReadonlyMap<string, number>
}

/**
 * Rule rows first (parked replies → on → paused → most recent chat), then — in the 全部 segment only —
 * the loaded chats without a rule. A chat never appears twice.
 */
export function buildRuleRows({ rules, ruleSessions, pageSessions, query, segment, parked }: RuleRowsInput): RuleRow[] {
  const page = new Map(pageSessions.map((s) => [s.id, s]))
  const ruled = new Set(rules.map((r) => r.sessionId))
  const withRule: RuleRow[] = []
  for (const rule of rules) {
    // The page copy is the fresher one; the resolved copy covers chats that are not loaded yet.
    const session = page.get(rule.sessionId) ?? ruleSessions.get(rule.sessionId)
    if (!session || !isRuleTarget(session) || !matchesSegment(rule, segment)) continue
    if (!page.has(session.id) && !sessionMatchesQuery(session, query)) continue
    withRule.push({ session, rule })
  }
  withRule.sort(
    (a, b) =>
      (parked.get(b.session.id) ?? 0) - (parked.get(a.session.id) ?? 0) ||
      STATUS_RANK[ruleStatusLine(a.rule).kind] - STATUS_RANK[ruleStatusLine(b.rule).kind] ||
      (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0),
  )
  if (segment !== 'all') return withRule
  const unset = pageSessions
    .filter((s) => isRuleTarget(s) && !ruled.has(s.id))
    .map((session): RuleRow => ({ session, rule: undefined }))
  return [...withRule, ...unset]
}
