/**
 * memoryTools — remember / recall / forget / list_memories over services.memory (a MemoryStore).
 * Risk and profiles drive approval & mounting in the kernel; nothing here is channel specific.
 */
import type { MemoryEntry, MemoryFile, MemoryStore, ToolContext, ToolResult } from '@aiwc/protocol'
import { defineTool } from '@aiwc/protocol'
import { z } from 'zod'
import { MEMORY_FILE_LABELS, usagePercent } from '../store/format'
import type { AnyToolDefinition } from '../types'

export interface MemoryToolServices {
  memory: MemoryStore
  [key: string]: unknown
}

const WritableFile = z.enum(['MEMORY', 'USER'])
const AnyFile = z.enum(['MEMORY', 'USER', 'SOUL', 'AGENTS'])

const fileHint = '（MEMORY = 当下事实与备忘，USER = 关于用户本人）'

function renderEntries(file: MemoryFile, entries: MemoryEntry[]): string {
  if (entries.length === 0) return `${file}（${MEMORY_FILE_LABELS[file]}）目前为空。`
  return [`${file}（${MEMORY_FILE_LABELS[file]}）共 ${entries.length} 条：`, ...entries.map((e) => `[${e.index}] ${e.text}`)].join('\n')
}

async function usageLine(memory: MemoryStore, file: MemoryFile): Promise<string> {
  const b = await memory.budget(file)
  return `${file} 已用 ${usagePercent(b.usedChars, b.limitChars)}%（${b.usedChars}/${b.limitChars} 字）`
}

const ok = (content: string): ToolResult => ({ content })
const fail = (content: string): ToolResult => ({ content, isError: true })

export function memoryTools(): AnyToolDefinition<MemoryToolServices>[] {
  const remember = defineTool<{ file: 'MEMORY' | 'USER'; text: string }, MemoryToolServices>({
    name: 'remember',
    description:
      `把一条值得跨会话记住的信息写入记忆文件${fileHint}。只记稳定、可复用的事实（偏好、关系、约定、环境），不记一次性的对话内容。` +
      '一条一个事实，尽量短。记忆有字数预算：写入失败并提示 over_budget 时，先用 forget 删掉过时条目再重试。写入成功后不要重复写同一条。',
    inputSchema: z.object({
      file: WritableFile.describe('写入哪个文件'),
      text: z.string().min(1).max(500).describe('要记住的内容，一句话'),
    }),
    profiles: ['desktop-chat', 'cron'],
    risk: 'write',
    parallelSafe: false,
    summarize: (i) => `写入 ${i.file}：${i.text.slice(0, 40)}${i.text.length > 40 ? '…' : ''}`,
    async execute(input, ctx) {
      const { memory } = ctx.services
      const r = await memory.addEntry(input.file, input.text, { source: 'agent' })
      if (r.ok) return ok(`已写入 ${input.file}。${await usageLine(memory, input.file)}。这次写入已完成，不要重复。`)
      if (r.reason === 'duplicate') return ok(`${input.file} 里已有内容相同的条目，无需重复写入。`)
      if (r.reason === 'blocked') return fail(`${input.file}.md 在磁盘上被外部修改，已自动备份；请用户到「设置 › 记忆」重新保存该文件后再写入。`)
      const entries = await memory.entries(input.file)
      return fail(`${input.file} 空间不足：${await usageLine(memory, input.file)}，本条 ${input.text.length} 字放不下。请先用 forget 删除过时或已合并的条目，再重试。\n${renderEntries(input.file, entries)}`)
    },
  })

  const recall = defineTool<{ query: string; limit?: number }, MemoryToolServices>({
    name: 'recall',
    description: '按关键词在 MEMORY / USER 里检索记忆条目（本地关键词匹配，不调用模型）。当用户提到的人、事、偏好可能之前记过时先查一下。',
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe('关键词或短句，中文可直接写词组'),
      limit: z.number().int().min(1).max(20).optional().describe('最多返回几条，默认 8'),
    }),
    profiles: ['desktop-chat', 'cron', 'subagent'],
    risk: 'read',
    parallelSafe: true,
    summarize: (i) => `检索记忆：${i.query}`,
    async execute(input, ctx) {
      const hits = await ctx.services.memory.search(input.query, input.limit ?? 8)
      if (hits.length === 0) return ok(`没有与「${input.query}」相关的记忆。`)
      return ok([`找到 ${hits.length} 条相关记忆：`, ...hits.map((h) => `[${h.file} #${h.entry.index}] ${h.entry.text}`)].join('\n'))
    },
  })

  const forget = defineTool<{ file: 'MEMORY' | 'USER'; index: number }, MemoryToolServices>({
    name: 'forget',
    description: `删除一条记忆${fileHint}。index 来自 list_memories 输出中方括号里的编号（从 0 开始）。删除不可恢复，只删过时、错误或已被新条目覆盖的内容。`,
    inputSchema: z.object({
      file: WritableFile,
      index: z.number().int().min(0).describe('list_memories 给出的编号'),
    }),
    profiles: ['desktop-chat'],
    risk: 'destructive',
    parallelSafe: false,
    summarize: (i) => `删除 ${i.file} 第 ${i.index} 条记忆`,
    async execute(input, ctx) {
      const { memory } = ctx.services
      const entries = await memory.entries(input.file)
      const target = entries[input.index]
      if (!target) return fail(`${input.file} 没有编号为 ${input.index} 的条目（共 ${entries.length} 条）。请先用 list_memories 查看。`)
      try {
        await memory.removeEntry(input.file, input.index)
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
      return ok(`已删除 ${input.file} 第 ${input.index} 条：「${target.text}」。${await usageLine(memory, input.file)}。`)
    },
  })

  const listMemories = defineTool<{ file: 'MEMORY' | 'USER' | 'SOUL' | 'AGENTS' }, MemoryToolServices>({
    name: 'list_memories',
    description: '列出某个记忆文件的全部条目及编号（MEMORY / USER / SOUL / AGENTS），用于整理、去重或在 forget 前确认编号。',
    inputSchema: z.object({ file: AnyFile }),
    profiles: ['desktop-chat', 'cron'],
    risk: 'read',
    parallelSafe: true,
    summarize: (i) => `查看 ${i.file}`,
    async execute(input, ctx: ToolContext<MemoryToolServices>) {
      const { memory } = ctx.services
      const entries = await memory.entries(input.file)
      return ok(`${renderEntries(input.file, entries)}\n${await usageLine(memory, input.file)}`)
    },
  })

  return [remember, recall, forget, listMemories]
}
