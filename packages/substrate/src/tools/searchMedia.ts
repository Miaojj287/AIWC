/**
 * search_media — find images / files / videos / stickers in chat history via listMessages kind
 * filters. Returns anchors + file names only (never bytes or local paths; the UI resolves media
 * from the anchor). Without a sessionId the scan is bounded to the most recently active sessions.
 */
import type { ListMessagesQuery, WxMessage } from '@aiwc/protocol'
import { z } from 'zod'
import { refuseForBot } from './botScope'
import {
  ABORTED_MESSAGE,
  READ_PROFILES_NO_BOT,
  TimeRangeRefinement,
  anchorOf,
  anchorsMeta,
  clampLimit,
  defineSubstrateTool,
  describeCoverage,
  describeToolError,
  displaySender,
  fail,
  fmtTime,
  isAborted,
  ok,
  squash,
} from './shared'

const RECENT_SESSION_CAP = 20
const PER_SESSION_CANDIDATES = 40
const SINGLE_SESSION_CANDIDATES = 400

const SearchMediaInput = z
  .object({
    query: z.string().trim().max(100).optional().describe('按文件名 / 附带文字 / 转写筛选的关键词；不填则按时间返回最近的媒体'),
    sessionId: z.string().trim().min(1).optional().describe('限定某会话（username）；不填则只扫最近活跃的若干会话'),
    kind: z.enum(['image', 'file', 'video', 'sticker']).describe('媒体类型'),
    from: z.number().int().nonnegative().optional().describe('起始时间，毫秒时间戳'),
    to: z.number().int().nonnegative().optional().describe('结束时间，毫秒时间戳'),
    limit: z.number().int().min(1).max(30).default(10).describe('返回条数上限（≤30）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

export type SearchMediaInput = z.infer<typeof SearchMediaInput>

const KIND_LABEL: Record<SearchMediaInput['kind'], string> = { image: '图片', file: '文件', video: '视频', sticker: '表情' }

function terms(query: string | undefined): string[] {
  return String(query ?? '').toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean)
}

function matchScore(m: WxMessage, ts: string[]): number {
  if (ts.length === 0) return 1
  const hay = [m.media?.fileName, m.text, m.media?.transcript, m.quote?.text].filter(Boolean).join(' ').toLowerCase()
  return ts.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
}

function shapeMedia(m: WxMessage) {
  const media = m.media
  return {
    anchor: anchorOf(m),
    kind: m.kind,
    time: fmtTime(m.createdAt),
    sender: displaySender(m),
    isSelf: m.isSelf,
    fileName: media?.fileName ?? null,
    sizeBytes: typeof media?.sizeBytes === 'number' ? media.sizeBytes : null,
    durationMs: typeof media?.durationMs === 'number' ? media.durationMs : null,
    text: squash(m.text, 120) || null,
  }
}

export const searchMedia = defineSubstrateTool({
  name: 'search_media',
  description:
    '检索聊天记录里的图片 / 文件 / 视频 / 表情，按会话、时间、文件名或附带文字筛选。返回每条媒体的 anchor（证据锚点）和文件名，不返回文件内容；需要看图或打开文件时把 anchor 交给界面处理。不带 sessionId 只扫最近活跃的若干会话，coverage 字段说明范围。只读本地数据。\n' +
    'Find images / files / videos / stickers in chat history. Returns anchors and file names only (no bytes, no paths). Without sessionId the scan is bounded to recent sessions — read `coverage`.',
  inputSchema: SearchMediaInput,
  // Scans across recent sessions without a sessionId: never offered to the bot.
  profiles: READ_PROFILES_NO_BOT,
  risk: 'read',
  parallelSafe: true,
  timeoutMs: 60_000,
  maxOutputChars: 24_000,
  summarize: (i) => `查找${KIND_LABEL[i.kind]}${i.query ? `「${i.query}」` : ''}${i.sessionId ? `（${i.sessionId}）` : '（最近会话）'}`,
  async execute(input, ctx) {
    const refused = refuseForBot(ctx)
    if (refused) return refused
    try {
      if (isAborted(ctx.signal)) return fail(ABORTED_MESSAGE)
      const substrate = ctx.services.substrate
      const ts = terms(input.query)
      const collected: WxMessage[] = []
      let sessionCount = 0

      const pull = async (sessionId: string, limit: number) => {
        const q: ListMessagesQuery = { sessionId, limit, kinds: [input.kind] }
        if (input.from !== undefined) q.from = input.from
        if (input.to !== undefined) q.to = input.to
        const res = await substrate.listMessages(q)
        collected.push(...res.items.filter((m) => m.kind === input.kind))
      }

      if (input.sessionId) {
        await pull(input.sessionId, clampLimit(input.limit * 8, SINGLE_SESSION_CANDIDATES, SINGLE_SESSION_CANDIDATES))
        sessionCount = 1
      } else {
        const sessions = await substrate.listSessions({ limit: RECENT_SESSION_CAP, kind: 'all' })
        const targets = sessions.items.filter((s) => s.kind === 'dm' || s.kind === 'group')
        for (const s of targets) {
          if (isAborted(ctx.signal)) return fail(ABORTED_MESSAGE)
          ctx.progress(`扫描 ${s.title}`, sessionCount / Math.max(1, targets.length))
          try {
            await pull(s.id, PER_SESSION_CANDIDATES)
            sessionCount += 1
          } catch {
            /* one session failing must not sink the whole scan */
          }
        }
      }

      const scored = collected
        .map((m) => ({ m, score: matchScore(m, ts) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt || b.m.seq - a.m.seq)
        .slice(0, input.limit)
      const hits = scored.map((x) => shapeMedia(x.m))
      const coverage = describeCoverage(substrate, {
        sessionIds: input.sessionId ? [input.sessionId] : undefined,
        from: input.from,
        to: input.to,
        scope: input.sessionId ? 'sessions' : 'recent_sessions',
        sessionCount,
      })
      return ok(
        {
          kind: input.kind,
          query: input.query ?? null,
          hits,
          coverage,
          ...(hits.length === 0 ? { note: `没有找到匹配的${KIND_LABEL[input.kind]}；可放宽关键词、指定 sessionId 或扩大时间范围。` } : {}),
        },
        anchorsMeta(hits.map((h) => h.anchor)),
      )
    } catch (error) {
      return fail(describeToolError(error, 'search_media 执行失败'))
    }
  },
})
