/**
 * Host hooks registered on the kernel's HookRunner. (The "Agent 已写入记忆" toast follows the memory store's own
 * change feed in composeMemory.ts, so a refused `remember` never shows it.)
 *  - dateHook: UserPromptSubmit → appends today's date so the model never guesses it.
 *  - citationAuditHook: Stop → checks every `wx://` citation in a desktop answer against the real
 *    message; a quote found nowhere near the cited message (or a message that does not exist) blocks, and the
 *    kernel sends the model back to write the whole answer again (the rewrite replaces the draft, and is audited
 *    again) before the turn completes. Every audit also reports a `citations` check (how many links it read, which
 *    failed) that the transcript shows as a compact system row, passing or not.
 */
import {
  findCitationClaims,
  quoteMatches,
  TURN_CHECK_MAX_ISSUES,
  TURN_CHECK_TEXT_CHARS,
  type CitationRef,
  type SubstrateService,
  type TurnCheck,
  type TurnCheckIssue,
  type WxMessage,
} from '@aiwc/protocol'
import type { Hook } from '@aiwc/kernel'

// eslint-disable-next-line aiwc/no-hardcoded-cjk -- model context (the prompts are Chinese), not UI copy
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const pad = (n: number) => String(n).padStart(2, '0')

export function formatChineseDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}（${WEEKDAYS[d.getDay()]}）`
}

export function dateHook(clock: () => Date = () => new Date()): Hook {
  return {
    name: 'host.date',
    events: ['UserPromptSubmit'],
    async run() {
      // eslint-disable-next-line aiwc/no-hardcoded-cjk -- model context, not UI copy
      return { additionalContext: `当前日期：${formatChineseDate(clock())}` }
    },
  }
}

/** Citations checked per answer; an answer citing more is audited on its first ones only. */
export const CITATION_AUDIT_LIMIT = 40
/**
 * Messages on each side of a cited one that may hold a quote without it counting as wrong: 「不是的」「只是小陈另有其人」
 * under one link quotes two consecutive messages — sloppy attribution, not invented words, so it is not worth
 * interrupting the answer with a correction (the chip still marks it).
 */
export const CITATION_NEIGHBOR_RADIUS = 5
const AUDIT_ISSUE_LIMIT = 8
const EXCERPT_CHARS = 120

const clip = (text: string): string =>
  text.length > TURN_CHECK_TEXT_CHARS ? `${text.slice(0, TURN_CHECK_TEXT_CHARS - 1)}…` : text

/** The report the transcript shows: issues kept up to the cap, every failure counted. */
function citationCheck(checked: number, found: TurnCheckIssue[]): TurnCheck {
  return {
    kind: 'citations',
    checked,
    failed: found.length,
    issues: found.slice(0, TURN_CHECK_MAX_ISSUES),
    action: 'none',
  }
}

const excerptOf = (m: WxMessage): string => {
  const text = (m.media?.transcript || m.text || `[${m.kind}]`).replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text
}

export function citationAuditHook(deps: {
  substrate: Pick<SubstrateService, 'getMessage' | 'getContext'>
  logger?: (level: 'warn', msg: string, meta?: unknown) => void
}): Hook {
  return {
    name: 'host.citationAudit',
    events: ['Stop'],
    async run(_event, payload) {
      // Only answers the owner reads in the Agent panel: bot / cron / persona text is not evidence prose.
      if (payload.origin?.channel !== 'desktop' || payload.profile !== 'desktop-chat') return
      const claims = findCitationClaims(payload.text ?? '').slice(0, CITATION_AUDIT_LIMIT)
      if (claims.length === 0) return
      const lookups = new Map<string, Promise<WxMessage | undefined | 'unavailable'>>()
      const lookup = (ref: CitationRef) => {
        const key = `${ref.sessionId}|${ref.messageId}`
        let job = lookups.get(key)
        if (!job) {
          job = deps.substrate.getMessage(ref.sessionId, ref.messageId).catch((err: unknown) => {
            deps.logger?.('warn', 'citation audit lookup failed', err)
            return 'unavailable' as const
          })
          lookups.set(key, job)
        }
        return job
      }
      const neighbours = async (message: WxMessage): Promise<WxMessage[] | 'unavailable'> => {
        try {
          return await deps.substrate.getContext(message.anchor, CITATION_NEIGHBOR_RADIUS)
        } catch (err) {
          deps.logger?.('warn', 'citation audit context failed', err)
          return 'unavailable'
        }
      }
      const issues: string[] = []
      const found: TurnCheckIssue[] = []
      for (const claim of claims) {
        const message = await lookup(claim)
        // Not connected / lookup failed: nothing can be verified, so nothing is flagged.
        if (message === 'unavailable') continue
        /* eslint-disable aiwc/no-hardcoded-cjk -- citation audit feedback is sent to the model, not shown as UI copy */
        if (!message) {
          issues.push(`${claim.link} 指向的消息在本地记录里不存在（可能是编造或抄错的 ID），不能作为证据。`)
          found.push({ code: 'missing_message', link: clip(claim.link) })
        } else {
          let unmatched = claim.quotes.filter((q) => !quoteMatches(q, message))
          if (unmatched.length > 0) {
            // A quote paired with the wrong link of the same run is still a real quote.
            const siblings = await Promise.all(
              claim.run.filter((ref) => ref.messageId !== claim.messageId).map((ref) => lookup(ref)),
            )
            unmatched = unmatched.filter(
              (q) => !siblings.some((m) => m !== undefined && m !== 'unavailable' && quoteMatches(q, m)),
            )
          }
          if (unmatched.length > 0) {
            const around = await neighbours(message)
            // Cannot read the surroundings: give the benefit of the doubt rather than force a correction.
            if (around === 'unavailable') unmatched = []
            else unmatched = unmatched.filter((q) => !around.some((m) => quoteMatches(q, m)))
          }
          for (const quote of unmatched) {
            issues.push(
              `引号里的「${quote}」不在 ${claim.link} 这条消息里，前后几条消息里也没有。这条消息的原文是：「${excerptOf(message)}」`,
            )
            found.push({
              code: 'quote_mismatch',
              link: clip(claim.link),
              quote: clip(quote),
              excerpt: clip(excerptOf(message)),
            })
          }
        }
        if (issues.length >= AUDIT_ISSUE_LIMIT) break
      }
      const checks = [citationCheck(claims.length, found)]
      if (issues.length === 0) return { checks }
      const reason = [
        `系统把你刚才回复里的引用和聊天原文逐字核对了一遍，有 ${issues.length} 处对不上：`,
        ...issues.map((issue, i) => `${i + 1}. ${issue}`),
        '请重新输出一遍完整的最终答复，它会替换掉上一版：把上面这些地方改对——引号里只放逐字原文，每段原文后面紧跟它自己那条消息的引用链接；拿不准就先用工具重新读原文，读不到就去掉引号改成转述。其余内容保持不变，不要提核对过程，也不要道歉。',
      ].join('\n')
      /* eslint-enable aiwc/no-hardcoded-cjk */
      return { block: { reason }, checks }
    },
  }
}
