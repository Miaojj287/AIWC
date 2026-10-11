/**
 * `update_plan`: lets the model publish / update its step list. The call's input IS the plan: the panel draws the
 * checklist from the latest update_plan call of the turn (live from its tool.call event, after a reload from the
 * recorded call), so the plan needs no side channel and survives a restart.
 */
import { z } from 'zod'
import { defineTool, type AnyToolDefinition } from '@aiwc/protocol'

export const PlanStepSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(['todo', 'doing', 'done', 'failed']),
})

export const UpdatePlanInput = z.object({
  steps: z.array(PlanStepSchema).min(1).max(50).describe('完整的步骤列表（每次传全部步骤，而不是增量）'),
})
export type UpdatePlanInputT = z.infer<typeof UpdatePlanInput>

export function planTools(): AnyToolDefinition[] {
  const updatePlan = defineTool<UpdatePlanInputT>({
    name: 'update_plan',
    description: '更新当前任务的步骤计划。多步任务开始前先列出步骤，每完成一步就把对应状态改为 done。',
    inputSchema: UpdatePlanInput,
    profiles: ['desktop-chat', 'subagent'],
    risk: 'read',
    parallelSafe: false,
    summarize: (i) => `更新计划（${i.steps.length} 步，${i.steps.filter((s) => s.status === 'done').length} 已完成）`,
    async execute() {
      return { content: 'ok' }
    },
  })
  return [updatePlan]
}
