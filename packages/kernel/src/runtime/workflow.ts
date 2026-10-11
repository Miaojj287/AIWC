/**
 * workflow_run — the agent lays out multi-step work as a small plan (a DAG of sub-agent steps) and the kernel runs
 * it: independent steps in parallel up to a cap, each step a one-shot child thread fed its dependencies' results.
 * Read steps are read-only children ('subagent'); write steps get the parent's tools, permission mode and allow-list,
 * so every write or send inside them still meets the approval matrix — answered in the parent conversation.
 * Progress is reported as a structured step list (✓ ⟳ ○ !) the panel renders under the tool row.
 */
import {
  defineTool,
  type JsonValue,
  type SubagentTrace,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
  type WorkflowRunView,
} from '@aiwc/protocol'
import { z } from 'zod'
import type { KernelInternal } from './types'
import {
  runWorkflow,
  validatePlan,
  workflowView,
  WorkflowStepFailure,
  type StepState,
  type WorkflowPlan,
  type WorkflowStepPlan,
} from './workflowEngine'

export const WORKFLOW_TOOL_NAME = 'workflow_run'
export const WORKFLOW_MAX_STEPS = 8
export const WORKFLOW_MAX_CONCURRENCY = 4
export const WORKFLOW_READ_STEP_CAP = 12
export const WORKFLOW_WRITE_STEP_CAP = 20
export const WORKFLOW_STEP_TIMEOUT_MS = 8 * 60_000
export const WORKFLOW_TOTAL_TIMEOUT_MS = 15 * 60_000
/** Per-step output kept in the result; 8 × 3000 stays well inside the tool's output cap so the card can parse it. */
const STEP_OUTPUT_CHARS = 3_000
/** A dependency's result handed to the next step's prompt. */
const DEPENDENCY_CHARS = 4_000
const WORKFLOW_MAX_OUTPUT_CHARS = 40_000

const StepSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .describe('步骤 id（小写字母开头，字母数字下划线），供 dependsOn 引用'),
  title: z.string().min(1).max(60).describe('步骤标题（简短，会显示在进度列表里）'),
  prompt: z.string().min(1).max(4000).describe('交给子代理的完整指令，需自包含；前置步骤的结果会自动附在后面'),
  dependsOn: z.array(z.string()).max(WORKFLOW_MAX_STEPS).default([]).describe('必须先完成的步骤 id'),
  mode: z
    .enum(['read', 'write'])
    .default('read')
    .describe('read = 只读子代理（默认）；write = 可调用写入 / 发送类工具，每次写入仍按当前权限模式征求用户确认'),
  output: z.enum(['text', 'json']).default('text').describe('json = 子代理只输出一个 JSON 值，解析失败算该步失败'),
  schema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('output 为 json 时期望的结构（JSON Schema）；顶层 required 字段会被检查'),
})

export const WorkflowInputSchema = z.object({
  title: z.string().min(1).max(60).describe('工作流标题'),
  steps: z.array(StepSchema).min(1).max(WORKFLOW_MAX_STEPS),
  maxConcurrency: z.number().int().min(1).max(WORKFLOW_MAX_CONCURRENCY).default(3).describe('最多同时运行的步骤数'),
})
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>

const READ_PREAMBLE =
  '你是工作流中的一个只读子代理：只能查询与分析，不得写入、发送或修改任何东西。完成后只输出这一步的结果（结论与证据锚点：会话 ID、消息 ID、联系人、文件路径、时间），不要复述过程。'
const WRITE_PREAMBLE =
  '你是工作流中的一个执行子代理：可以用工具完成这一步。写入、发送类操作会按当前权限模式征求用户确认；被拒绝时不要重试，在结果里说明。完成后只输出这一步的结果，不要复述过程。'

export function buildStepPrompt(
  step: WorkflowStepPlan,
  inputs: Array<{ step: WorkflowStepPlan; output: string }>,
): string {
  const parts = [step.mode === 'write' ? WRITE_PREAMBLE : READ_PREAMBLE, `步骤：${step.title}`, step.prompt]
  for (const { step: dep, output } of inputs) {
    const text = output.length > DEPENDENCY_CHARS ? `${output.slice(0, DEPENDENCY_CHARS)}…[已截断]` : output
    parts.push(`## 前置步骤「${dep.title}」的结果\n${text}`)
  }
  if (step.output === 'json') {
    parts.push(
      `最终答复只输出一个 JSON 值，不要任何其他文字。${step.schema ? `期望的结构：${JSON.stringify(step.schema)}` : ''}`,
    )
  }
  return parts.join('\n\n')
}

/** The JSON value in a step's answer (bare or fenced), checked against the schema's top-level `required`. */
export function parseStepJson(text: string, schema?: Record<string, unknown>): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch {
    const start = candidate.search(/[[{]/)
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    try {
      value = start >= 0 && end > start ? JSON.parse(candidate.slice(start, end + 1)) : undefined
    } catch {
      value = undefined
    }
  }
  if (value === undefined) throw new WorkflowStepFailure('invalid_json', '子代理没有输出可解析的 JSON')
  const required = Array.isArray(schema?.required) ? schema.required.filter((k) => typeof k === 'string') : []
  if (required.length > 0) {
    const missing =
      value && typeof value === 'object' && !Array.isArray(value)
        ? required.filter((k) => !(k in (value as Record<string, unknown>)))
        : required
    if (missing.length > 0) throw new WorkflowStepFailure('invalid_json', `JSON 缺少字段：${missing.join('、')}`)
  }
  return JSON.stringify(value)
}

const reasonOf = (err: unknown): string | undefined =>
  err && typeof err === 'object' && 'reason' in err && typeof err.reason === 'string' ? err.reason : undefined

export function createWorkflowTool(getKernel: () => KernelInternal): ToolDefinition<WorkflowInput, ToolServices> {
  return defineTool<WorkflowInput, ToolServices>({
    name: WORKFLOW_TOOL_NAME,
    description:
      `把多步工作编排成工作流交给子代理执行：每步一个子代理，按 dependsOn 排序，彼此独立的步骤并行（最多 ${WORKFLOW_MAX_CONCURRENCY} 个），前置步骤的结果自动交给后续步骤。` +
      `最多 ${WORKFLOW_MAX_STEPS} 步，每步最多 ${WORKFLOW_STEP_TIMEOUT_MS / 60_000} 分钟。mode 默认 read（只读）；需要写文件、推送或发送时用 write，其中每次写入仍会征求用户确认。` +
      '适合可以拆成几块、需要分头查或先查后写的任务；简单问题直接回答，单纯并行查询用 delegate_analysis。',
    inputSchema: WorkflowInputSchema,
    profiles: ['desktop-chat', 'cron'],
    // Launching is harmless: every write a step makes is gated on its own.
    risk: 'read',
    parallelSafe: false,
    timeoutMs: WORKFLOW_TOTAL_TIMEOUT_MS,
    maxOutputChars: WORKFLOW_MAX_OUTPUT_CHARS,
    // The plan's own title (the model's words): the card under the row carries the steps.
    summarize: (input) => input.title,
    async execute(input, ctx: ToolContext<ToolServices>) {
      if (ctx.depth > 0) return { content: '子代理不能再启动工作流。', isError: true }
      const plan: WorkflowPlan = {
        title: input.title,
        maxConcurrency: input.maxConcurrency,
        steps: input.steps.map((s) => ({ ...s, dependsOn: [...new Set(s.dependsOn)] })),
      }
      const invalid = validatePlan(plan)
      if (invalid) return { content: `工作流无效：${invalid}`, isError: true }
      const kernel = getKernel()
      const total = plan.steps.length
      const traces: SubagentTrace[] = []
      const report = (states: ReadonlyMap<string, StepState>): void => {
        const finished = [...states.values()].filter((s) => s.status !== 'pending' && s.status !== 'running').length
        const runningTitles = plan.steps.filter((s) => states.get(s.id)?.status === 'running').map((s) => s.title)
        const view = workflowView(plan, states, { done: false })
        ctx.progress(runningTitles.length ? runningTitles.join('、') : `${finished}/${total}`, finished / total, view)
      }
      const states = await runWorkflow(plan, {
        stepTimeoutMs: WORKFLOW_STEP_TIMEOUT_MS,
        signal: ctx.signal,
        onUpdate: report,
        async runStep(step, inputs, signal, pauseClock) {
          let text: string
          try {
            const result = await kernel.runChild({
              parentThreadId: ctx.threadId,
              parentTurnId: ctx.turnId,
              parentCallId: ctx.callId,
              step: step.id,
              // A write step waiting for approval holds its own limit, the tool's timeout and the turn budget.
              onApprovalWait: () => {
                const resumeStep = pauseClock()
                const resumeCall = ctx.pauseTimeouts?.()
                return () => {
                  resumeStep()
                  resumeCall?.()
                }
              },
              onTrace: (trace) => traces.push(trace),
              origin: ctx.origin ?? { channel: ctx.channel },
              input: { content: [{ type: 'text', text: buildStepPrompt(step, inputs) }], mentions: [] },
              depth: 1,
              maxSteps: step.mode === 'write' ? WORKFLOW_WRITE_STEP_CAP : WORKFLOW_READ_STEP_CAP,
              signal,
              label: step.title,
              profile: step.mode === 'write' ? ctx.profile : 'subagent',
            })
            text = result.text.trim()
          } catch (err) {
            if (reasonOf(err) === 'step_cap') throw new WorkflowStepFailure('step_cap', '子代理步数用完仍未完成')
            throw err
          }
          if (!text) throw new WorkflowStepFailure('failed', '子代理没有返回结果')
          return step.output === 'json' ? parseStepJson(text, step.schema) : text
        },
      })
      const view: WorkflowRunView = workflowView(plan, states, { done: true, outputChars: STEP_OUTPUT_CHARS })
      ctx.progress(view.status, 1, workflowView(plan, states, { done: true }))
      return {
        content: view as unknown as JsonValue,
        isError: view.status === 'failed' || view.status === 'cancelled',
        ...(traces.length ? { subagents: traces } : {}),
      }
    },
  })
}
