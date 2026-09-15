/**
 * Tool router: one frozen per-step view of the tools and the single dispatch funnel
 *   validate → approval → PreToolUse → execute (timeout) → PostToolUse → truncate.
 * dispatch() never throws; every path ends in a ToolDispatchOutcome plus tool.call events.
 */
import {
  newApprovalId,
  type ApprovalDecision,
  type Event,
  type JsonValue,
  type PermissionMode,
  type ToolArtifact,
  type ToolCallPolicy,
  type ToolCallStatus,
  type ToolContext,
  type AnyToolDefinition,
  type ToolProfile,
  type ToolResult,
  type ToolRisk,
  type ToolServices,
  type ToolSpecForModel,
} from '@aiwc/protocol'
import type {
  ApprovalGate,
  HookRunner,
  ToolCallRequest,
  ToolDispatchContext,
  ToolDispatchOutcome,
  ToolRegistry,
  ToolRouter,
  ToolRouterFactory,
} from '../ports'
import { compactInput, toJsonValue, truncateText, zodToJsonSchema } from './schema'

export const DEFAULT_TOOL_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_OUTPUT_CHARS = 16_000

export interface ToolRouterPolicy {
  defaultTimeoutMs?: number
  maxOutputChars?: number
}

/**
 * ports.ts build() options plus the runtime getters the approval step needs. The getters are
 * optional so the frozen ToolRouterFactory shape stays satisfiable; without them the router
 * behaves as Ask mode with an empty allow-list.
 */
export interface ToolRouterBuildOptions {
  profile: ToolProfile
  depth: number
  deny?: readonly string[]
  permissionMode?: () => PermissionMode
  allowAlways?: () => readonly string[]
  /** Called when the user answers an approval with "总是允许"; the runtime persists it into ThreadSettings. */
  onAllowAlways?: (toolName: string) => void
}

export interface ToolRouterFactoryWithOptions extends ToolRouterFactory {
  build(opts: ToolRouterBuildOptions): ToolRouter
}

export interface ToolRouterFactoryDeps {
  registry: ToolRegistry
  approvals: ApprovalGate
  hooks: HookRunner
  services: ToolServices
  policy?: ToolRouterPolicy
}

type AnyTool = AnyToolDefinition

export const USER_DENIED_MESSAGE = '用户拒绝了此操作'
export const POLICY_DENIED_MESSAGE = '当前权限模式或通道不允许此操作'

export function createToolRouterFactory(deps: ToolRouterFactoryDeps): ToolRouterFactoryWithOptions {
  return {
    build(opts: ToolRouterBuildOptions): ToolRouter {
      const tools = new Map<string, AnyTool>()
      for (const tool of deps.registry.forProfile(opts.profile, { deny: opts.deny, depth: opts.depth })) {
        tools.set(tool.name, tool)
      }
      const specs: ToolSpecForModel[] = [...tools.values()]
        .filter((t) => t.exposure !== 'hidden')
        .map((t) => ({ name: t.name, description: t.description, inputJsonSchema: zodToJsonSchema(t.inputSchema) }))
      Object.freeze(specs)

      const summarize = (name: string, input: unknown): string => {
        const tool = tools.get(name)
        if (tool?.summarize) {
          try {
            return tool.summarize(input)
          } catch {
            /* fall through to the generic summary */
          }
        }
        const compact = compactInput(input)
        return compact ? `${name} ${compact}` : name
      }

      return {
        specs,
        has: (name) => tools.has(name),
        risk: (name) => tools.get(name)?.risk,
        parallelSafe: (name) => tools.get(name)?.parallelSafe ?? false,
        summarize,
        dispatch: (call, ctx) => dispatch({ deps, opts, tools, summarize, call, ctx }),
      }
    },
  }
}

interface DispatchArgs {
  deps: ToolRouterFactoryDeps
  opts: ToolRouterBuildOptions
  tools: Map<string, AnyTool>
  summarize: (name: string, input: unknown) => string
  call: ToolCallRequest
  ctx: ToolDispatchContext
}

async function dispatch(args: DispatchArgs): Promise<ToolDispatchOutcome> {
  const { deps, opts, tools, call, ctx } = args
  const startedAt = Date.now()
  const tool = tools.get(call.toolName)
  // The definition's static risk until the input is validated; `classify` may then replace it.
  let risk: ToolRisk = tool?.risk ?? 'read'
  let allowKeyForEvent: string | undefined = undefined
  let input: unknown = call.input
  let summary = safeSummary(args.summarize, call.toolName, input)

  const emitCall = (
    status: ToolCallStatus,
    extra?: { output?: JsonValue | string; isError?: boolean; artifacts?: ToolArtifact[] },
  ): void => {
    const event: Event = {
      type: 'tool.call',
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      stepId: ctx.stepId,
      callId: call.callId,
      toolName: call.toolName,
      summary,
      input: toJsonValue(input),
      status,
      risk,
      ...(allowKeyForEvent ? { allowKey: allowKeyForEvent } : {}),
      startedAt,
      ...(status === 'pending' || status === 'awaiting_approval' || status === 'running'
        ? {}
        : { durationMs: Date.now() - startedAt }),
      ...extra,
    }
    safeEmit(ctx, event)
  }

  const finish = (status: ToolDispatchOutcome['status'], result: ToolResult): ToolDispatchOutcome => {
    const isError = status !== 'done' || result.isError === true
    emitCall(status, { output: toJsonValue(result.content), isError, artifacts: result.artifacts })
    return {
      callId: call.callId,
      toolName: call.toolName,
      result: { ...result, isError },
      isError,
      status,
      durationMs: Date.now() - startedAt,
      artifacts: result.artifacts,
    }
  }
  const fail = (status: ToolDispatchOutcome['status'], message: string): ToolDispatchOutcome =>
    finish(status, { content: message, isError: true })

  // (a) unknown tool
  if (!tool) {
    emitCall('pending')
    return fail('error', `unsupported tool: ${call.toolName}`)
  }
  emitCall('pending')

  // (b) validate
  const parsed = tool.inputSchema.safeParse(input)
  if (!parsed.success) return fail('error', formatIssues(parsed.error.issues))
  input = parsed.data
  summary = safeSummary(args.summarize, call.toolName, input)

  // (c) approval — per-call policy first (a shell command's risk depends on the command), then the matrix.
  const policy = safeClassify(tool, input)
  if (policy) risk = policy.risk
  const allowKey = policy?.allowKey ?? tool.name
  allowKeyForEvent = allowKey
  const mode = opts.permissionMode?.() ?? 'ask'
  const allowAlways = opts.allowAlways?.() ?? []
  const verdict = deps.approvals.decide({
    toolName: tool.name,
    allowKey,
    risk,
    mode,
    channel: ctx.channel,
    allowAlways,
  })
  // "总是允许" is offered only where the gate honours it: saving this key must turn the same call into 'approved'.
  // Derived from the gate's own decision, so it follows the matrix (a send or destructive call asks every time).
  const canAllowAlways =
    policy?.canAllowAlways !== false &&
    deps.approvals.decide({
      toolName: tool.name,
      allowKey,
      risk,
      mode,
      channel: ctx.channel,
      allowAlways: [...allowAlways, allowKey],
    }) === 'approved'
  if (verdict === 'denied')
    return fail('denied', ctx.channel === 'cron' ? cronDeniedMessage(tool.name, allowKey) : POLICY_DENIED_MESSAGE)
  if (verdict === 'ask') {
    emitCall('awaiting_approval')
    const decision = await askApproval({
      deps,
      opts,
      tool,
      ctx,
      call,
      summary,
      input,
      risk,
      canAllowAlways,
      detail: policy?.note,
    })
    if (decision === 'deny') return fail('denied', USER_DENIED_MESSAGE)
    if (decision === 'allow_always') safeCall(() => opts.onAllowAlways?.(allowKey))
  }
  if (ctx.signal.aborted) return fail('error', '已中断')

  emitCall('running')

  // (d) PreToolUse
  const pre = await deps.hooks.run('PreToolUse', {
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    toolName: tool.name,
    input,
  })
  if (pre.block) return fail('error', `工具调用被 hook 拦截：${pre.block.reason}`)
  if (pre.updatedInput !== undefined) {
    const reparsed = tool.inputSchema.safeParse(pre.updatedInput)
    if (!reparsed.success) return fail('error', `hook 改写后的参数无效：${formatIssues(reparsed.error.issues)}`)
    input = reparsed.data
    summary = safeSummary(args.summarize, call.toolName, input)
  }

  // (e) execute with timeout
  const timeoutMs = tool.timeoutMs ?? deps.policy?.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const exec = await executeWithTimeout({ deps, tool, input, ctx, call, timeoutMs })
  if (exec.kind === 'timeout') return fail('timeout', `工具执行超时（${timeoutMs}ms）`)
  if (exec.kind === 'aborted') return fail('error', '已中断')
  if (exec.kind === 'threw') return fail('error', `工具执行失败：${exec.message}`)
  let result: ToolResult = exec.result

  // (f) PostToolUse
  const post = await deps.hooks.run('PostToolUse', {
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    toolName: tool.name,
    input,
    output: result.content,
  })
  if (post.updatedOutput !== undefined) result = { ...result, content: post.updatedOutput }

  // (g) truncate at record time
  const maxChars = tool.maxOutputChars ?? deps.policy?.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  const asText = typeof result.content === 'string' ? result.content : safeStringify(result.content)
  const cut = truncateText(asText, maxChars)
  if (cut.truncated) result = { ...result, content: cut.text }

  return finish(result.isError ? 'error' : 'done', result)
}

interface AskArgs {
  deps: ToolRouterFactoryDeps
  opts: ToolRouterBuildOptions
  tool: AnyTool
  ctx: ToolDispatchContext
  call: ToolCallRequest
  summary: string
  input: unknown
  risk: ToolRisk
  canAllowAlways: boolean
  detail?: string
}

/** A tool's classifier must never break dispatch: a throwing classifier leaves the static risk in place. */
function safeClassify(tool: AnyTool, input: unknown): ToolCallPolicy | undefined {
  if (!tool.classify) return undefined
  try {
    return tool.classify(input)
  } catch {
    return undefined
  }
}

/** What the model reads when a scheduled run hits a tool the task was not granted. */
function cronDeniedMessage(toolName: string, allowKey: string): string {
  return `定时任务的权限模式不允许此操作（${allowKey === toolName ? toolName : `${toolName}：${allowKey}`}），已跳过。用户可以在任务设置里调高权限模式后重新运行；请说明这一点并继续完成其余部分。`
}

async function askApproval(a: AskArgs): Promise<ApprovalDecision> {
  const approvalId = newApprovalId()
  const { canAllowAlways } = a
  const inputJson = toJsonValue(a.input)
  safeEmit(a.ctx, {
    type: 'approval.requested',
    threadId: a.ctx.threadId,
    turnId: a.ctx.turnId,
    approvalId,
    callId: a.call.callId,
    toolName: a.tool.name,
    summary: a.summary,
    ...(a.detail ? { detail: a.detail } : {}),
    input: inputJson,
    risk: a.risk,
    canAllowAlways,
  })
  let decision: ApprovalDecision
  try {
    decision = await a.deps.approvals.ask(
      {
        approvalId,
        threadId: a.ctx.threadId,
        turnId: a.ctx.turnId,
        callId: a.call.callId,
        toolName: a.tool.name,
        summary: a.summary,
        input: inputJson,
        risk: a.risk,
        canAllowAlways,
      },
      a.ctx.signal,
    )
  } catch {
    decision = 'deny'
  }
  if (decision === 'allow_always' && !canAllowAlways) decision = 'allow_once'
  safeEmit(a.ctx, { type: 'approval.resolved', threadId: a.ctx.threadId, approvalId, decision })
  return decision
}

type ExecOutcome =
  { kind: 'ok'; result: ToolResult } | { kind: 'timeout' } | { kind: 'aborted' } | { kind: 'threw'; message: string }

async function executeWithTimeout(a: {
  deps: ToolRouterFactoryDeps
  tool: AnyTool
  input: unknown
  ctx: ToolDispatchContext
  call: ToolCallRequest
  timeoutMs: number
}): Promise<ExecOutcome> {
  const ac = new AbortController()
  const onOuterAbort = (): void => ac.abort(a.ctx.signal.reason)
  if (a.ctx.signal.aborted) return { kind: 'aborted' }
  a.ctx.signal.addEventListener('abort', onOuterAbort, { once: true })

  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      ac.abort(new Error('timeout'))
      reject(new Error('timeout'))
    }, a.timeoutMs)
  })

  const toolCtx: ToolContext = {
    threadId: a.ctx.threadId,
    turnId: a.ctx.turnId,
    stepId: a.ctx.stepId,
    callId: a.call.callId,
    channel: a.ctx.channel,
    profile: a.ctx.profile,
    origin:
      a.ctx.origin?.chatId !== undefined ? { channel: a.ctx.origin.channel, chatId: a.ctx.origin.chatId } : undefined,
    signal: ac.signal,
    services: a.deps.services,
    progress: (message, fraction) =>
      safeEmit(a.ctx, { type: 'tool.progress', threadId: a.ctx.threadId, callId: a.call.callId, message, fraction }),
    depth: a.ctx.depth,
  }

  try {
    const result = await Promise.race([Promise.resolve().then(() => a.tool.execute(a.input, toolCtx)), timeout])
    if (!result || typeof result !== 'object' || !('content' in result)) {
      return { kind: 'threw', message: '工具未返回有效结果' }
    }
    return { kind: 'ok', result }
  } catch (err) {
    if (timedOut) return { kind: 'timeout' }
    if (a.ctx.signal.aborted) return { kind: 'aborted' }
    return { kind: 'threw', message: err instanceof Error ? err.message : String(err) }
  } finally {
    if (timer) clearTimeout(timer)
    a.ctx.signal.removeEventListener('abort', onOuterAbort)
  }
}

function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  const parts = issues.slice(0, 6).map((i) => {
    const path = i.path.map(String).join('.')
    return path ? `${path}: ${i.message}` : i.message
  })
  const more = issues.length > 6 ? `；另有 ${issues.length - 6} 处` : ''
  return `参数校验失败：${parts.join('；')}${more}`
}

function safeSummary(fn: (name: string, input: unknown) => string, name: string, input: unknown): string {
  try {
    return fn(name, input)
  } catch {
    return name
  }
}

function safeEmit(ctx: ToolDispatchContext, event: Event): void {
  try {
    ctx.emit(event)
  } catch {
    /* listeners must not break dispatch */
  }
}

function safeCall(fn: () => void): void {
  try {
    fn()
  } catch {
    /* ignore */
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
