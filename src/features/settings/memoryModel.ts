/**
 * 记忆 page helpers (DESIGN-SPEC §2 记忆): the four files' copy, budget maths and the 条数上限 input
 * validation. Pure — tested in memoryModel.test.ts.
 */
import { MEMORY_FILES as MEMORY_FILE_NAMES, type MemoryBudget, type MemoryFile } from '@aiwc/protocol'
import { getLanguage, t, type MessageKey } from '@/i18n'

export interface MemoryFileMeta {
  file: MemoryFile
  label: MessageKey
  description: MessageKey
}

const FILE_COPY: Record<MemoryFile, Omit<MemoryFileMeta, 'file'>> = {
  MEMORY: { label: 'settings.memory.files.memory.label', description: 'settings.memory.files.memory.description' },
  USER: { label: 'settings.memory.files.user.label', description: 'settings.memory.files.user.description' },
  SOUL: { label: 'settings.memory.files.soul.label', description: 'settings.memory.files.soul.description' },
  AGENTS: { label: 'settings.memory.files.agents.label', description: 'settings.memory.files.agents.description' },
}

/** The protocol's memory files, in protocol order, with their settings-page copy. */
export const MEMORY_FILES: readonly MemoryFileMeta[] = MEMORY_FILE_NAMES.map((file) => ({ file, ...FILE_COPY[file] }))

export const memoryFileName = (file: MemoryFile): string => `${file}.md`

export function budgetRatio(b: MemoryBudget | undefined): number {
  if (!b || b.limitChars <= 0) return 0
  return Math.min(1, Math.max(0, b.usedChars / b.limitChars))
}

/** Second line of a file row: `12 条 · 已用 1.2k / 8k 字`. */
export function memoryStatusLine(entryCount: number | undefined, budget: MemoryBudget | undefined): string {
  const parts: string[] = []
  if (entryCount !== undefined) parts.push(t('settings.memory.entries', { n: entryCount }))
  if (budget)
    parts.push(t('settings.memory.used', { used: compact(budget.usedChars), limit: compact(budget.limitChars) }))
  return parts.join(' · ') || t('settings.memory.loading')
}

/** `1.2k` below ten thousand in every language; larger counts use the UI language's compact notation (`2万` / `20k`). */
export function compact(n: number): string {
  if (n >= 10_000)
    return new Intl.NumberFormat(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 })
      .format(n)
      .toLowerCase()
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return String(n)
}

export const MAX_ENTRIES_MIN = 10
export const MAX_ENTRIES_MAX = 2000

export type MaxEntriesValidation = { ok: true; value: number } | { ok: false; error: string }

export function parseMaxEntries(raw: string): MaxEntriesValidation {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: t('settings.memory.maxEntries.integer') }
  const value = Number(trimmed)
  if (value < MAX_ENTRIES_MIN || value > MAX_ENTRIES_MAX)
    return { ok: false, error: t('settings.memory.maxEntries.range', { min: MAX_ENTRIES_MIN, max: MAX_ENTRIES_MAX }) }
  return { ok: true, value }
}

/** True when saving would exceed the file budget (mirrors the main-side check so the error is inline). */
export function overBudget(markdown: string, budget: MemoryBudget | undefined): boolean {
  return Boolean(budget && budget.limitChars > 0 && markdown.length > budget.limitChars)
}
