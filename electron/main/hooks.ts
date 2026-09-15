/**
 * Host hooks registered on the kernel's HookRunner.
 *  - dateHook: UserPromptSubmit → appends today's date so the model never guesses it.
 *  - memoryToastHook: PostToolUse(remember) → right-bottom toast (CLAUDE.md §4.6 / DESIGN-SPEC §2 记忆).
 *  - citationAuditHook: Stop → checks every `wx://` citation in a desktop answer against the real
 *    message; a quote that is not in its message (or a message that does not exist) blocks once, and
 *    the kernel lets the model append a short correction before the turn completes.
 */
import {
  findCitationClaims,
  unmatchedQuotes,
  type SubstrateService,
  type ToastPayload,
  type WxMessage,
} from '@aiwc/protocol'
import type { Hook } from '@aiwc/kernel'
import { t } from './i18n'

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

/** Tool names whose successful completion means memory was written. */
export const MEMORY_WRITE_TOOLS: readonly string[] = ['remember']

function outputLooksLikeError(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const o = output as { isError?: unknown; ok?: unknown }
  return o.isError === true || o.ok === false
}

export function memoryToastHook(toast: (payload: ToastPayload) => void): Hook {
  return {
    name: 'host.memoryToast',
    events: ['PostToolUse'],
    async run(_event, payload) {
      if (!payload.toolName || !MEMORY_WRITE_TOOLS.includes(payload.toolName)) return
      if (outputLooksLikeError(payload.output)) return
      toast({
        id: 'memory.written',
        kind: 'success',
        text: t('main.agent.memoryWritten'),
        action: { label: t('main.clone.view'), command: 'tab.openSettings' },
      })
    },
  }
}

/** Citations checked per answer; an answer citing more is audited on its first ones only. */
export const CITATION_AUDIT_LIMIT = 40
const AUDIT_ISSUE_LIMIT = 8
const EXCERPT_CHARS = 120

const excerptOf = (m: WxMessage): string => {
  const text = (m.media?.transcript || m.text || `[${m.kind}]`).replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text
}

export function citationAuditHook(deps: {
  substrate: Pick<SubstrateService, 'getMessage'>
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
      const issues: string[] = []
      for (const claim of claims) {
        const key = `${claim.sessionId}|${claim.messageId}`
        let lookup = lookups.get(key)
        if (!lookup) {
          lookup = deps.substrate.getMessage(claim.sessionId, claim.messageId).catch((err: unknown) => {
            deps.logger?.('warn', 'citation audit lookup failed', err)
            return 'unavailable' as const
          })
          lookups.set(key, lookup)
        }
        const message = await lookup
        // Not connected / lookup failed: nothing can be verified, so nothing is flagged.
        if (message === 'unavailable') continue
        /* eslint-disable aiwc/no-hardcoded-cjk -- citation audit feedback is sent to the model, not shown as UI copy */
        if (!message) {
          issues.push(`${claim.link} 指向的消息在本地记录里不存在（可能是编造或抄错的 ID），不能作为证据。`)
        } else {
          for (const quote of unmatchedQuotes(claim.context, message)) {
            issues.push(
              `引号里的「${quote}」不在 ${claim.link} 这条消息里。这条消息的原文是：「${excerptOf(message)}」`,
            )
          }
        }
        if (issues.length >= AUDIT_ISSUE_LIMIT) break
      }
      if (issues.length === 0) return
      const reason = [
        `系统把你刚才回复里的引用和聊天原文逐字核对了一遍，有 ${issues.length} 处对不上：`,
        ...issues.map((issue, i) => `${i + 1}. ${issue}`),
        '请紧接着输出一段简短的「更正」：逐条说明哪句话不准确、原文实际是什么；拿不准就先用工具重新读原文。只写更正，不要重复整篇回答，也不要道歉。引号里只放原文，并附上正确的引用链接。',
      ].join('\n')
      /* eslint-enable aiwc/no-hardcoded-cjk */
      return { block: { reason } }
    },
  }
}
