/**
 * 每日待办 (daily todos): an opt-in scan of the group chats the user picked. Each scan reads the new
 * messages of every picked chat since the previous scan, sends them to the configured model once per
 * chat, and keeps two things on this machine: a checklist of todos (checked off / deleted by the user,
 * like a notes checklist) and a per-day summary of each chat.
 *
 * Nothing here runs unless `todo.enabled` is on and at least one chat is picked; the schedule is the
 * user's (every N hours / daily at a time / manual only). Shared by the main process (store, scanner,
 * IPC validation) and the renderer (dashboard, settings).
 */
import { z } from 'zod'
import type { Millis } from './ids'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Hour steps offered for 每隔 N 小时 — all divide 24, so the scan lands on the same clock hours every day. */
export const TODO_HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12] as const
export const TODO_DEFAULT_TIME = '09:00'
export const TODO_DEFAULT_MAX_MESSAGES = 200
/** Messages-per-chat caps offered by settings (the newest N of each scan window are read). */
export const TODO_MESSAGE_CAPS = [50, 100, 200, 400] as const
export const TODO_MAX_SOURCES = 30
export const TODO_TEXT_MAX = 200
export const TODO_DUE_MAX = 40
/** Summary of one chat for one day, as the model is asked to write it (characters, not tokens). */
export const TODO_SUMMARY_MAX = 400

export const TodoScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hourly'),
    everyHours: z
      .number()
      .int()
      .refine((n) => (TODO_HOUR_STEPS as readonly number[]).includes(n)),
  }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME_RE) }),
  /** Only when the user presses 立即扫描. */
  z.object({ kind: z.literal('manual') }),
])
export type TodoSchedule = z.infer<typeof TodoScheduleSchema>
export type TodoScheduleKind = TodoSchedule['kind']
export const TODO_SCHEDULE_KINDS = ['hourly', 'daily', 'manual'] as const satisfies readonly TodoScheduleKind[]
export const DEFAULT_TODO_SCHEDULE: TodoSchedule = { kind: 'daily', time: TODO_DEFAULT_TIME }

/** A chat the user picked for scanning. The title is a display fallback; the live one comes from the substrate. */
export const TodoSourceSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(200).default(''),
})
export type TodoSource = z.infer<typeof TodoSourceSchema>

export const TODO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const TodoItemSchema = z.object({
  id: z.string().regex(TODO_ID_RE),
  text: z.string().trim().min(1).max(TODO_TEXT_MAX),
  /** 'scan' = extracted from a chat; 'user' = typed into the checklist. */
  origin: z.enum(['scan', 'user']),
  sourceId: z.string().max(200).optional(),
  sourceTitle: z.string().max(200).optional(),
  /** The message the todo came from, for 跳到聊天. */
  messageId: z.string().max(200).optional(),
  messageAt: z.number().optional(),
  /** Deadline as the chat phrased it (周五前, 明早 10 点); never parsed into a date. */
  due: z.string().max(TODO_DUE_MAX).optional(),
  createdAt: z.number(),
  done: z.boolean(),
  doneAt: z.number().optional(),
})
export type TodoItem = z.infer<typeof TodoItemSchema>

/** What one day's scans said about one chat; later scans of the same day fold into it. */
export const TodoChatSummarySchema = z.object({
  sourceId: z.string().max(200),
  title: z.string().max(200),
  summary: z.string().max(TODO_SUMMARY_MAX * 2),
  messageCount: z.number().int().nonnegative(),
  /** Window the summary covers (oldest → newest message read). */
  from: z.number(),
  to: z.number(),
  updatedAt: z.number(),
})
export type TodoChatSummary = z.infer<typeof TodoChatSummarySchema>

export const TodoDaySchema = z.object({
  date: z.string().regex(DATE_RE),
  chats: z.array(TodoChatSummarySchema),
  updatedAt: z.number(),
})
export type TodoDay = z.infer<typeof TodoDaySchema>

/** Why a scan did not run or did not finish. Stable codes; the UI maps them to copy. */
export const TodoScanFailureSchema = z.enum([
  'disabled',
  'no_sources',
  'busy',
  'model_unavailable',
  'substrate_unavailable',
  'cancelled',
  'failed',
])
export type TodoScanFailure = z.infer<typeof TodoScanFailureSchema>

export const TodoScanTriggerSchema = z.enum(['manual', 'schedule', 'catch_up'])
export type TodoScanTrigger = z.infer<typeof TodoScanTriggerSchema>

export const TodoScanResultSchema = z.object({
  ok: z.boolean(),
  failure: TodoScanFailureSchema.optional(),
  /** Provider / substrate error text for a failure (data, not UI copy). */
  detail: z.string().max(500).optional(),
  trigger: TodoScanTriggerSchema,
  startedAt: z.number(),
  finishedAt: z.number(),
  /** Chats read / chats whose model call failed (their messages are retried by the next scan). */
  scanned: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
})
export type TodoScanResult = z.infer<typeof TodoScanResultSchema>

export interface TodoStatus {
  enabled: boolean
  sources: number
  running: boolean
  last?: TodoScanResult
  /** When the schedule fires next; absent while disabled, with no chats, or on 仅手动. */
  nextRunAt?: Millis
}

export type TodoScanStep = 'collect' | 'summarize' | 'save'

export interface TodoProgress {
  step: TodoScanStep
  /** Chats finished in this step / chats in the scan. */
  done: number
  total: number
  /** Title of the chat just finished (summarize). */
  source?: string
}

/** Local calendar date (YYYY-MM-DD) of a timestamp. */
export function todoDateOf(ms: Millis): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isTodoDate = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value)

/** Open items first (newest first), then checked items (most recently checked first). */
export function sortTodoItems(items: readonly TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.done) return (b.doneAt ?? 0) - (a.doneAt ?? 0)
    return b.createdAt - a.createdAt
  })
}
