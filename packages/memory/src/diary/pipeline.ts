/**
 * createDiaryPipeline — nightly synthesis over the substrate.
 *
 * run(date):
 *   选材      window = [date-1 @ hour, date @ hour); ≤16 sessions with the most messages, ≤40 messages each
 *   按会话小结 one bounded model call per session (concurrency 3, ≤120 字); a failed call falls back to the raw excerpt
 *   综合      ONE synthesis call → first-person diary + ## 记忆线索 (+ optional ## 稳定事实 fed to MEMORY)
 *   写入      DiaryEntry; when the model is unavailable / fails, a degraded entry is written instead
 *
 * start()/stop(): croner job daily at schedule().hour, plus a catch-up run on start when the last diary
 * is older than the window that most recently closed.
 */
import type { DiaryEntry, DiaryPipeline, DiaryStore, MemoryStore, ModelClient, SubstrateService } from '@aiwc/protocol'
import { Cron } from 'croner'
import { mapConcurrent, sampleText } from '../internal/model'
import { truncateChars } from '../internal/text'
import { clampHour, isValidDate } from '../internal/time'
import {
  DIARY_MAX_SESSIONS,
  DIARY_MESSAGES_PER_SESSION,
  collectSessionMaterials,
  diaryWindow,
  renderMaterial,
  targetDateFor,
  windowLabel,
  type DiaryWindow,
  type SessionMaterial,
} from './select'
import {
  DIARY_MAX_FACTS,
  padCues,
  parseSynthesis,
  renderDegraded,
  sessionSummarySystem,
  sessionSummaryUser,
  synthesisSystem,
  synthesisUser,
} from './prompts'

/** Structural twin of RolloutStore['search'] (kernel port) so memory does not depend on the kernel. */
export type RolloutSearchFn = (
  query: string,
  opts?: { limit?: number },
) => Promise<Array<{ threadId: string; itemId: string; snippet: string; ts: number }>>

export interface DiarySchedule {
  enabled: boolean
  hour: number
  customPrompt?: string
}

export interface DiaryPipelineDeps {
  substrate: SubstrateService
  memory: MemoryStore
  diaries: DiaryStore
  model: () => Promise<ModelClient>
  rolloutSearch?: RolloutSearchFn
  schedule: () => DiarySchedule
  /** injectable clock (tests) */
  now?: () => number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface DiaryPipelineExt extends DiaryPipeline {
  start(): void
  stop(): void
  /** Run the catch-up check once (start() does this in the background). Resolves with the entry when one was produced. */
  runCatchUp(): Promise<DiaryEntry | undefined>
  /** Date whose window most recently closed under the current schedule. */
  targetDateNow(): string
}

const SUMMARY_CONCURRENCY = 3
const SUMMARY_MAX_TOKENS = 400
const SYNTHESIS_MAX_TOKENS = 2000
const AGENT_DIGEST_MAX = 20
const EXCERPT_LINES = 8

type Progress = (step: string, fraction: number) => void

interface SectionDraft {
  material: SessionMaterial
  text: string
  isSummary: boolean
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function excerptOf(material: SessionMaterial): string {
  const lines = renderMaterial(material, 80).split('\n')
  const head = lines.slice(0, EXCERPT_LINES)
  return head.join('\n') + (lines.length > head.length ? `\n…（共 ${material.count} 条）` : '')
}

export function createDiaryPipeline(deps: DiaryPipelineDeps): DiaryPipelineExt {
  const now = deps.now ?? (() => Date.now())
  const log = deps.logger ?? (() => {})
  let cron: Cron | undefined
  let lastRunDate: string | undefined
  let running: Promise<DiaryEntry> | undefined

  const hourNow = () => clampHour(deps.schedule().hour)

  async function summarise(model: ModelClient | undefined, materials: SessionMaterial[], w: DiaryWindow, signal: AbortSignal | undefined, progress: Progress): Promise<SectionDraft[]> {
    if (!model) return materials.map((material) => ({ material, text: excerptOf(material), isSummary: false }))
    const label = windowLabel(w)
    const results = await mapConcurrent(
      materials,
      SUMMARY_CONCURRENCY,
      async (material) => {
        const text = await sampleText(
          model,
          sessionSummarySystem(material.session.title, material.session.kind, label),
          sessionSummaryUser(material.session.title, material.count, renderMaterial(material)),
          { signal, maxOutputTokens: SUMMARY_MAX_TOKENS, temperature: 0.3 },
        )
        const clean = text.replace(/\s+/g, ' ').trim()
        if (!clean) throw new Error('empty summary')
        return truncateChars(clean, 160)
      },
      (done, total) => progress('按会话小结', 0.3 + 0.45 * (done / total)),
    )
    return materials.map((material, i) => {
      const text = results[i]
      return text ? { material, text, isSummary: true } : { material, text: excerptOf(material), isSummary: false }
    })
  }

  async function agentDigest(materials: SessionMaterial[], w: DiaryWindow): Promise<{ text: string; turns: number }> {
    const search = deps.rolloutSearch
    if (!search) return { text: '', turns: 0 }
    const queries = materials.slice(0, 5).map((m) => m.session.title).filter((t) => t.trim().length > 0)
    const seen = new Map<string, { snippet: string; ts: number }>()
    for (const q of queries) {
      try {
        for (const hit of await search(q, { limit: 10 })) {
          if (hit.ts < w.start || hit.ts >= w.end) continue
          seen.set(hit.itemId, { snippet: hit.snippet, ts: hit.ts })
        }
      } catch (e) {
        log('warn', 'diary: rollout search failed', { query: q, error: errMsg(e) })
      }
    }
    const rows = [...seen.values()].sort((a, b) => a.ts - b.ts).slice(0, AGENT_DIGEST_MAX)
    return { text: rows.map((r) => `- ${truncateChars(r.snippet.replace(/\s+/g, ' ').trim(), 160)}`).join('\n'), turns: rows.length }
  }

  async function feedMemory(facts: string[]): Promise<void> {
    let written = 0
    for (const fact of facts) {
      if (written >= DIARY_MAX_FACTS) break
      try {
        const r = await deps.memory.addEntry('MEMORY', fact, { source: 'diary' })
        if (r.ok) written++
        else if (r.reason === 'over_budget' || r.reason === 'blocked') break
      } catch (e) {
        log('warn', 'diary: memory write failed', { error: errMsg(e) })
        break
      }
    }
  }

  async function runInner(date: string, opts: NonNullable<Parameters<DiaryPipeline['run']>[1]>): Promise<DiaryEntry> {
    const progress: Progress = (step, f) => opts.onProgress?.(step, Math.max(0, Math.min(1, f)))
    const signal = opts.signal
    const sched = deps.schedule()
    const w = diaryWindow(date, clampHour(sched.hour))

    progress('选材', 0.02)
    const { materials, totalMessages } = await collectSessionMaterials(deps.substrate, w, {
      maxSessions: DIARY_MAX_SESSIONS,
      perSession: DIARY_MESSAGES_PER_SESSION,
      signal,
      onProgress: (done, total) => progress('选材', 0.02 + 0.26 * (total ? done / total : 1)),
    })
    if (signal?.aborted) throw new Error('aborted')

    const sessions = materials.map((m) => m.session.id)
    const finish = async (entry: DiaryEntry) => {
      progress('写入', 0.95)
      await deps.diaries.put(entry)
      if (!lastRunDate || lastRunDate < date) lastRunDate = date
      progress('完成', 1)
      return entry
    }

    if (materials.length === 0) {
      return finish({
        date,
        markdown: `## 今天\n${windowLabel(w)} 没有可整理的聊天记录。`,
        cues: padCues([], ['无聊天记录'], date),
        sources: { sessions: [], messageCount: 0, agentTurns: 0 },
        generatedAt: now(),
      })
    }

    let model: ModelClient | undefined
    let modelError: string | undefined
    try {
      model = await deps.model()
    } catch (e) {
      modelError = errMsg(e)
      log('warn', 'diary: model unavailable, writing degraded entry', { error: modelError })
    }

    progress('按会话小结', 0.3)
    const sections = await summarise(model, materials, w, signal, progress)
    const digest = await agentDigest(materials, w)
    if (signal?.aborted) throw new Error('aborted')

    const titles = materials.map((m) => m.session.title)
    const sources = { sessions, messageCount: totalMessages, agentTurns: digest.turns }

    progress('综合', 0.78)
    if (model) {
      try {
        const raw = await sampleText(
          model,
          synthesisSystem(date, sched.customPrompt),
          synthesisUser({
            date,
            summaries: sections.map((s) => ({ title: s.material.session.title, kind: s.material.session.kind, count: s.material.count, text: s.text })),
            ...(digest.text ? { agentDigest: digest.text } : {}),
          }),
          { signal, maxOutputTokens: SYNTHESIS_MAX_TOKENS, temperature: 0.7 },
        )
        const parsed = parseSynthesis(raw)
        const entry = await finish({
          date,
          markdown: parsed.body,
          cues: padCues(parsed.cues, titles, date),
          sources,
          generatedAt: now(),
        })
        if (parsed.facts.length) await feedMemory(parsed.facts)
        return entry
      } catch (e) {
        modelError = errMsg(e)
        log('warn', 'diary: synthesis failed, writing degraded entry', { error: modelError })
      }
    }

    return finish({
      date,
      markdown: renderDegraded({
        date,
        reason: modelError ? `模型调用失败（${truncateChars(modelError, 80)}）` : '模型不可用',
        sections: sections.map((s) => ({ title: s.material.session.title, kind: s.material.session.kind, count: s.material.count, text: s.text, isSummary: s.isSummary })),
        ...(digest.text ? { agentDigest: digest.text } : {}),
      }),
      cues: padCues(titles.slice(0, 8), ['降级日记'], date),
      sources,
      generatedAt: now(),
      degraded: true,
    })
  }

  const pipeline: DiaryPipelineExt = {
    async run(date, opts = {}) {
      if (!isValidDate(date)) throw new Error(`日期格式应为 YYYY-MM-DD：${date}`)
      const existing = await deps.diaries.get(date)
      if (existing && !opts.force && !existing.degraded) return existing
      if (running) await running.catch(() => undefined) // one diary at a time; the second waits
      running = runInner(date, opts)
      try {
        return await running
      } finally {
        running = undefined
      }
    },

    nextScheduledAt() {
      const next = cron?.nextRun()
      return next ? next.getTime() : undefined
    },

    targetDateNow() {
      return targetDateFor(now(), hourNow())
    },

    async runCatchUp() {
      if (!deps.schedule().enabled) return undefined
      const target = targetDateFor(now(), hourNow())
      const last = lastRunDate ?? (await deps.diaries.list())[0]?.date
      if (last && last >= target) return undefined
      try {
        return await pipeline.run(target)
      } catch (e) {
        log('error', 'diary: catch-up run failed', { date: target, error: errMsg(e) })
        return undefined
      }
    },

    start() {
      pipeline.stop()
      const sched = deps.schedule()
      if (!sched.enabled) return
      const hour = clampHour(sched.hour)
      cron = new Cron(`0 0 ${hour} * * *`, { protect: true, catch: (e) => log('error', 'diary: scheduled run threw', { error: errMsg(e) }) }, async () => {
        if (!deps.schedule().enabled) return
        const date = targetDateFor(now(), hourNow())
        try {
          await pipeline.run(date)
        } catch (e) {
          log('error', 'diary: scheduled run failed', { date, error: errMsg(e) })
        }
      })
      void pipeline.runCatchUp()
    },

    stop() {
      cron?.stop()
      cron = undefined
    },
  }
  return pipeline
}
