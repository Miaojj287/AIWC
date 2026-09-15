/**
 * Clone status → view mapping and list copy (DESIGN-SPEC §4). Pure — tested in cloneView.test.ts.
 */
import type { CloneStatus } from '@aiwc/protocol'
import { t, type MessageKey } from '@/i18n'

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

/** 约 1 分钟 / 约 30 秒 / 即将完成; `remaining` words it for the building card (预计还需 1 分钟). */
export function formatEta(ms: number | undefined, style: 'short' | 'remaining' = 'short'): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const key = style === 'remaining' ? 'clone.eta.remaining' : 'clone.eta.short'
  if (ms < 5_000) return t(key, { unit: 'soon', n: 0 })
  if (ms < 60_000) return t(key, { unit: 'seconds', n: Math.ceil(ms / 10_000) * 10 })
  return t(key, { unit: 'minutes', n: Math.ceil(ms / 60_000) })
}

/** 1 分 12 秒 / 45 秒 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? t('clone.elapsed.minutes', { m, s }) : t('clone.elapsed.seconds', { s })
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
      const text = t('clone.status.building', { percent: pct })
      return { text: eta ? `${text} · ${eta}` : text, tone: 'accent' }
    }
    case 'ready':
      return { text: t('clone.status.ready', { version: status.version, n: status.sampleCount }), tone: 'ok' }
    case 'failed':
      return { text: t('clone.status.failed', { reason: failureTitle(status.kind) }), tone: 'danger' }
    case 'none':
      return {
        text: t('clone.status.none', { n: status.messageCount, count: fmt(status.messageCount) }),
        tone: 'neutral',
      }
    default:
      return {
        text:
          messageCount !== undefined
            ? t('clone.status.none', { n: messageCount, count: fmt(messageCount) })
            : t('clone.status.notCloned'),
        tone: 'neutral',
      }
  }
}

export function failureTitle(kind: Extract<CloneStatus, { state: 'failed' }>['kind']): string {
  switch (kind) {
    case 'model':
      return t('clone.failure.model')
    case 'too_few_messages':
      return t('clone.failure.tooFewMessages')
    default:
      return t('clone.failure.unknown')
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

export function filterContacts<T extends CloneListEntry>(
  entries: readonly T[],
  query: string,
  segment: CloneSegment,
): T[] {
  const q = query.trim().toLowerCase()
  return entries.filter(
    (e) =>
      (segment === 'all' || e.status.state === 'ready') &&
      (!q || e.displayName.toLowerCase().includes(q) || e.contactId.toLowerCase().includes(q)),
  )
}

export function readyCount(entries: readonly CloneListEntry[]): number {
  return entries.filter((e) => e.status.state === 'ready').length
}

export type TrainingRange = 'all' | 'year' | 'quarter'

/** Labels are catalog keys — resolve with t() at render. */
export const RANGE_OPTIONS: ReadonlyArray<{ value: TrainingRange; label: MessageKey; description: MessageKey }> = [
  { value: 'quarter', label: 'clone.range.quarter', description: 'clone.range.quarterDescription' },
  { value: 'year', label: 'clone.range.year', description: 'clone.range.yearDescription' },
  { value: 'all', label: 'clone.range.all', description: 'clone.range.allDescription' },
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

/** Fallback step labels as catalog keys; buildSteps resolves them when called. */
export const DEFAULT_BUILD_STEPS = [
  'clone.building.steps.read',
  'clone.building.steps.style',
  'clone.building.steps.samples',
  'clone.building.steps.save',
] as const satisfies readonly MessageKey[]

export function buildSteps(
  progress: { done: number; total: number; step: string },
  labels: readonly string[] = DEFAULT_BUILD_STEPS.map((key) => t(key)),
): BuildStep[] {
  const total = Math.max(progress.total, labels.length)
  const out: BuildStep[] = []
  for (let i = 0; i < total; i++) {
    const label =
      i === progress.done && progress.step
        ? progress.step
        : (labels[Math.min(i, labels.length - 1)] ?? t('clone.building.steps.nth', { n: i + 1 }))
    out.push({ id: `step-${i}`, label, status: i < progress.done ? 'done' : i === progress.done ? 'doing' : 'todo' })
  }
  return out
}
