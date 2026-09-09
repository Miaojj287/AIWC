/**
 * Clone status → view mapping and list copy (DESIGN-SPEC §4). Pure — tested in cloneView.test.ts.
 */
import type { CloneStatus } from '@aiwc/protocol'

export type CloneView = 'idle' | 'building' | 'ready' | 'failed'

/** Which page the clone Tab shows for a status. */
export function viewFor(status: CloneStatus | undefined): CloneView {
  switch (status?.state) {
    case 'building':
      return 'building'
    case 'ready':
      return 'ready'
    case 'failed':
      return 'failed'
    default:
      return 'idle'
  }
}

/** Messages below this count get a warning on the confirm page (still allowed). */
export const MIN_RECOMMENDED_MESSAGES = 300

export function progressPercent(progress: { done: number; total: number }): number {
  if (progress.total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)))
}

/** 约 1 分钟 / 约 30 秒 / 即将完成 */
export function formatEta(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  if (ms < 5_000) return '即将完成'
  if (ms < 60_000) return `约 ${Math.ceil(ms / 10_000) * 10} 秒`
  return `约 ${Math.ceil(ms / 60_000)} 分钟`
}

/** 1 分 12 秒 / 45 秒 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

export type StatusTone = 'ok' | 'accent' | 'danger' | 'neutral'

export interface CloneStatusLine {
  text: string
  tone: StatusTone
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** Second line of a contact in the AI 克隆 list. */
export function cloneStatusLine(status: CloneStatus | undefined, messageCount?: number): CloneStatusLine {
  switch (status?.state) {
    case 'building': {
      const pct = progressPercent(status.progress)
      const eta = formatEta(status.progress.etaMs)
      return { text: `克隆中 · ${pct}%${eta ? ` · ${eta}` : ''}`, tone: 'accent' }
    }
    case 'ready':
      return { text: `已克隆 · v${status.version} · ${status.sampleCount} 个样本`, tone: 'ok' }
    case 'failed':
      return { text: `失败 · ${failureTitle(status.kind)}`, tone: 'danger' }
    case 'none':
      return { text: `未克隆 · ${fmt(status.messageCount)} 条消息`, tone: 'neutral' }
    default:
      return { text: messageCount !== undefined ? `未克隆 · ${fmt(messageCount)} 条消息` : '未克隆', tone: 'neutral' }
  }
}

export function failureTitle(kind: Extract<CloneStatus, { state: 'failed' }>['kind']): string {
  switch (kind) {
    case 'model':
      return '模型错误'
    case 'too_few_messages':
      return '有效消息过少'
    default:
      return '未知错误'
  }
}

export type CloneSegment = 'all' | 'ready'

export interface CloneListEntry {
  contactId: string
  displayName: string
  status: CloneStatus
  messageCount?: number
  lastContactAt?: number
  avatarPath?: string
}

export function filterContacts<T extends CloneListEntry>(entries: readonly T[], query: string, segment: CloneSegment): T[] {
  const q = query.trim().toLowerCase()
  return entries.filter((e) => (segment === 'all' || e.status.state === 'ready') && (!q || e.displayName.toLowerCase().includes(q) || e.contactId.toLowerCase().includes(q)))
}

export function readyCount(entries: readonly CloneListEntry[]): number {
  return entries.filter((e) => e.status.state === 'ready').length
}

export type TrainingRange = 'all' | 'year' | 'quarter'

export const RANGE_OPTIONS: ReadonlyArray<{ value: TrainingRange; label: string; description: string }> = [
  { value: 'quarter', label: '最近 3 个月', description: '只用近期消息，更贴近当前说话方式' },
  { value: 'year', label: '最近 1 年', description: '推荐 · 兼顾样本量与时效' },
  { value: 'all', label: '全部', description: '使用全部历史消息' },
]

const DAY = 86_400_000

/** Convert a training range into clone:start's `range` argument. */
export function rangeToQuery(range: TrainingRange, now: number): { from?: number; to?: number } | undefined {
  switch (range) {
    case 'quarter':
      return { from: now - 90 * DAY, to: now }
    case 'year':
      return { from: now - 365 * DAY, to: now }
    default:
      return undefined
  }
}

/** Step list for the building card; step names come from the backend progress. */
export interface BuildStep {
  id: string
  label: string
  status: 'todo' | 'doing' | 'done'
}

export const DEFAULT_BUILD_STEPS = ['读取消息与语音转写', '提炼说话风格、口头禅与常用表情', '生成样本对话', '写入本地画像 · 不上传'] as const

export function buildSteps(progress: { done: number; total: number; step: string }, labels: readonly string[] = DEFAULT_BUILD_STEPS): BuildStep[] {
  const total = Math.max(progress.total, labels.length)
  const out: BuildStep[] = []
  for (let i = 0; i < total; i++) {
    const label = i === progress.done && progress.step ? progress.step : labels[Math.min(i, labels.length - 1)] ?? `第 ${i + 1} 步`
    out.push({ id: `step-${i}`, label, status: i < progress.done ? 'done' : i === progress.done ? 'doing' : 'todo' })
  }
  return out
}
