/**
 * delegate_analysis — fan out up to four read-only sub-analyses to one-shot child threads (profile
 * 'subagent', depth 1, 12-step cap) and return only their conclusions + evidence anchors.
 */
import { defineTool, type ToolContext, type ToolDefinition, type ToolServices } from '@aiwc/protocol'
import { z } from 'zod'
import type { KernelInternal } from './types'

export const DELEGATE_TOOL_NAME = 'delegate_analysis'
export const DELEGATE_MAX_TASKS = 4
export const DELEGATE_CHILD_STEP_CAP = 12

export const DelegateInputSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(60).describe('子任务标题（简短）'),
        prompt: z.string().min(1).max(4000).describe('交给子代理的完整分析指令，需自包含'),
      }),
    )
    .min(1)
    .max(DELEGATE_MAX_TASKS),
})
export type DelegateInput = z.infer<typeof DelegateInputSchema>

const CHILD_PREAMBLE = [
  '你是一个只读的分析子代理：只能查询与分析，不得写入、发送或修改任何东西。',
  '完成后只输出结论与证据锚点（会话 ID、消息 ID、联系人、文件路径、时间），不要复述过程，不超过 400 字。',
].join('\n')

export function createDelegateTool(getKernel: () => KernelInternal): ToolDefinition<DelegateInput, ToolServices> {
  return defineTool<DelegateInput, ToolServices>({
    name: DELEGATE_TOOL_NAME,
    description: `把彼此独立的分析子任务委派给只读子代理并行执行（最多 ${DELEGATE_MAX_TASKS} 个），每个子代理最多 ${DELEGATE_CHILD_STEP_CAP} 步，只返回结论与证据锚点。适合需要分头查多个会话或时间段的问题。`,
    inputSchema: DelegateInputSchema,
    profiles: ['desktop-chat'],
    risk: 'read',
    parallelSafe: false,
    timeoutMs: 10 * 60_000,
    summarize: (input) => `委派 ${input.tasks.length} 项分析：${input.tasks.map((t) => t.title).join('、')}`,
    async execute(input, ctx: ToolContext<ToolServices>) {
      if (ctx.depth > 0) return { content: '子代理不能再次委派。', isError: true }
      const kernel = getKernel()
      const results = await Promise.all(
        input.tasks.map(async (task, index) => {
          ctx.progress(`子任务 ${index + 1}/${input.tasks.length}：${task.title}`, index / input.tasks.length)
          try {
            const r = await kernel.runChild({
              parentThreadId: ctx.threadId,
              origin: ctx.origin ?? { channel: ctx.channel },
              input: { content: [{ type: 'text', text: `${CHILD_PREAMBLE}\n\n任务：${task.title}\n${task.prompt}` }], mentions: [] },
              depth: 1,
              maxSteps: DELEGATE_CHILD_STEP_CAP,
              signal: ctx.signal,
              label: task.title,
            })
            return { title: task.title, ok: true as const, text: r.text.trim() || '（子代理没有返回结论）' }
          } catch (err) {
            return { title: task.title, ok: false as const, text: err instanceof Error ? err.message : String(err) }
          }
        }),
      )
      ctx.progress('全部子任务完成', 1)
      const content = results.map((r) => `## ${r.title}${r.ok ? '' : '（失败）'}\n${r.text}`).join('\n\n')
      return { content, isError: results.every((r) => !r.ok), meta: { failed: results.filter((r) => !r.ok).length } }
    },
  })
}
