/**
 * `update_plan`: lets the model publish / update its step list. The plan is surfaced to the UI as
 * a `plan.updated` event through `ctx.services.emit`, which the composition root must inject
 * (services.emit = (event: Event) => void). Without it the tool still succeeds silently.
 */
import { z } from 'zod'
import { defineTool, type Event, type ToolDefinition } from '@aiwc/protocol'

export const PlanStepSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(['todo', 'doing', 'done', 'failed']),
})

export const UpdatePlanInput = z.object({
  steps: z.array(PlanStepSchema).min(1).max(50).describe('完整的步骤列表（每次传全部步骤，而不是增量）'),
})
export type UpdatePlanInputT = z.infer<typeof UpdatePlanInput>

export interface PlanToolServices {
  emit?: (event: Event) => void
  [key: string]: unknown
}

export function planTools(): ToolDefinition<any, any>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const updatePlan = defineTool<UpdatePlanInputT, PlanToolServices>({
    name: 'update_plan',
    description: '更新当前任务的步骤计划。多步任务开始前先列出步骤，每完成一步就把对应状态改为 done。',
    inputSchema: UpdatePlanInput,
    profiles: ['desktop-chat', 'subagent'],
    risk: 'read',
    parallelSafe: false,
    summarize: (i) => `更新计划（${i.steps.length} 步，${i.steps.filter((s) => s.status === 'done').length} 已完成）`,
    async execute(input, ctx) {
      const emit = ctx.services.emit
      if (typeof emit === 'function') {
        emit({ type: 'plan.updated', threadId: ctx.threadId, steps: input.steps })
      }
      return { content: 'ok' }
    },
  })
  return [updatePlan]
}
