/**
 * 记忆 page helpers (DESIGN-SPEC §2 记忆): the four files' copy, budget maths and the 条数上限 input
 * validation. Pure — tested in memoryModel.test.ts.
 */
import type { MemoryBudget, MemoryFile } from '@aiwc/protocol'

export interface MemoryFileMeta {
  file: MemoryFile
  label: string
  description: string
}

export const MEMORY_FILES: readonly MemoryFileMeta[] = [
  { file: 'MEMORY', label: '长期记忆', description: 'Agent 跨会话记住的事实与偏好' },
  { file: 'USER', label: '用户画像', description: '称呼、身份、常用群与联系人' },
  { file: 'SOUL', label: '人格与语气', description: '回复风格、称呼习惯' },
  { file: 'AGENTS', label: '工作规则', description: '推送前必须确认、不读取隐私群等' },
]

export const memoryFileName = (file: MemoryFile): string => `${file}.md`

export const isMemoryFile = (v: unknown): v is MemoryFile => typeof v === 'string' && MEMORY_FILES.some((m) => m.file === v)

export function budgetRatio(b: MemoryBudget | undefined): number {
  if (!b || b.limitChars <= 0) return 0
  return Math.min(1, Math.max(0, b.usedChars / b.limitChars))
}

/** Second line of a file row: `12 条 · 已用 1.2k / 8k 字`. */
export function memoryStatusLine(entryCount: number | undefined, budget: MemoryBudget | undefined): string {
  const parts: string[] = []
  if (entryCount !== undefined) parts.push(`${entryCount} 条`)
  if (budget) parts.push(`已用 ${compact(budget.usedChars)} / ${compact(budget.limitChars)} 字`)
  return parts.join(' · ') || '读取中…'
}

export function compact(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(n % 10_000 === 0 ? 0 : 1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return String(n)
}

export const MAX_ENTRIES_MIN = 10
export const MAX_ENTRIES_MAX = 2000

export type MaxEntriesValidation = { ok: true; value: number } | { ok: false; error: string }

export function parseMaxEntries(raw: string): MaxEntriesValidation {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return { ok: false, error: '请输入整数' }
  const value = Number(t)
  if (value < MAX_ENTRIES_MIN || value > MAX_ENTRIES_MAX) return { ok: false, error: `范围 ${MAX_ENTRIES_MIN} – ${MAX_ENTRIES_MAX}` }
  return { ok: true, value }
}

/** True when saving would exceed the file budget (mirrors the main-side check so the error is inline). */
export function overBudget(markdown: string, budget: MemoryBudget | undefined): boolean {
  return Boolean(budget && budget.limitChars > 0 && markdown.length > budget.limitChars)
}
