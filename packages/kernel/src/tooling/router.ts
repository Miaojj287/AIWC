/**
 * Tool router: one frozen per-step view of the tools and the single dispatch funnel
 *   validate → approval → PreToolUse → execute (timeout) → PostToolUse → truncate.
 * dispatch() never throws; every path ends in a ToolDispatchOutcome plus tool.call events.
 */
import {
  newApprovalId,
  type GrantScope,
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
  type ToolSummary,
} from '@aiwc/protocol'
import type {
  ApprovalAnswer,
  ApprovalGate,
  HookRunner,
  QuestionGate,
  ToolCallRequest,
  ToolDispatchContext,
  ToolDispatchOutcome,
  ToolRegistry,
  ToolRouter,
  ToolRouterFactory,
} from '../ports'
import { createTurnBudget } from '../runtime/turnBudget'
import { bindAskUser } from './questions'
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
  /**
   * Called when the user answers an approval with "总是允许": the runtime persists `key` (a tool name or a command
   * prefix) into ThreadSettings for scope 'thread', or into the global grants for scope 'global'.
   */
  onAllowAlways?: (key: string, scope: GrantScope) => void
  /** The thread's model runs on this machine: tools that send their input elsewhere (`offDevice`) are not mounted. */
  localModel?: boolean
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
  /** Pending `ask_user` questions (questions.ts); without it no tool can ask the user. */
  questions?: QuestionGate
}

type AnyTool = AnyToolDefinition

export const USER_DENIED_MESSAGE = '用户拒绝了此操作'
export const POLICY_DENIED_MESSAGE = '当前权限模式或通道不允许此操作'
/** Shown with a re-asked approval: a PreToolUse hook changed the call after it was approved. */
const HOOK_REWRITE_NOTE = 'PreToolUse hook 改写了这次调用的参数'

export function createToolRouterFactory(deps: ToolRouterFactoryDeps): ToolRouterFactoryWithOptions {
  return {
    build(opts: ToolRouterBuildOptions): ToolRouter {
      const tools = new Map<string, AnyTool>()
      for (const tool of deps.registry.forProfile(opts.profile, { deny: opts.deny, depth: opts.depth })) {
        if (opts.localModel && tool.offDevice) continue
        tools.set(tool.name, tool)
      }
      const specs: ToolSpecForModel[] = [...tools.values()]
        .filter((t) => t.exposure !== 'hidden')
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputJsonSchema: t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema),
        }))
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

      const describe = (name: string, input: unknown): ToolSummary | undefined => {
        const tool = tools.get(name)
        if (!tool?.describe) return undefined
        try {
          return tool.describe(input)
        } catch {
          // a describer that cannot read this input leaves the row to the generic wording
          return undefined
        }
      }

      return {
        specs,
        has: (name) => tools.has(name),
        risk: (name) => tools.get(name)?.risk,
        parallelSafe: (name) => tools.get(name)?.parallelSafe ?? false,
        summarize,
        describe,
        dispatch: (call, ctx) => dispatch({ deps, opts, tools, summarize, describe, call, ctx }),
      }
    },
  }
}

interface DispatchArgs {
  deps: ToolRouterFactoryDeps
  opts: ToolRouterBuildOptions
  tools: Map<string, AnyTool>
  summarize: (name: string, input: unknown) => string
  describe: (name: string, input: unknown) => ToolSummary | undefined
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
  let display = args.describe(call.toolName, input)
  const resummarize = (): void => {
    summary = safeSummary(args.summarize, call.toolName, input)
    display = args.describe(call.toolName, input)
  }

  const emitCall = (
    status: ToolCallStatus,
    extra?: {
      output?: JsonValue | string
      isError?: boolean
      artifacts?: ToolArtifact[]
      subagents?: ToolResult['subagents']
    },
  ): void => {
    const event: Event = {
      type: 'tool.call',
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      stepId: ctx.stepId,
      callId: call.callId,
      toolName: call.toolName,
      summary,
      ...(display ? { display } : {}),
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
    emitCall(status, {
      output: toJsonValue(result.content),
      isError,
      artifacts: result.artifacts,
      ...(result.subagents?.length ? { subagents: result.subagents } : {}),
    })
    return {
      callId: call.callId,
      toolName: call.toolName,
      result: { ...result, isError },
      isError,
      status,
      durationMs: Date.now() - startedAt,
      artifacts: result.artifacts,
      ...(result.subagents?.length ? { subagents: result.subagents } : {}),
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
  resummarize()

  // (c) approval — per-call policy first (a shell command's risk depends on the command), then the matrix.
  // Returns the failed outcome, or undefined when the call may run. Run again on a hook-rewritten input.
  const gate = async (rewrittenByHook: boolean): Promise<ToolDispatchOutcome | undefined> => {
    const policy = safeClassify(tool, input)
    risk = policy?.risk ?? tool.risk
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
      const detail = [policy?.note, rewrittenByHook ? HOOK_REWRITE_NOTE : undefined].filter(Boolean).join('；')
      const answer = await askApproval({
        deps,
        opts,
        tool,
        ctx,
        call,
        summary,
        display,
        input,
        risk,
        canAllowAlways,
        allowKey,
        ...(detail ? { detail } : {}),
      })
      if (answer.decision === 'deny') return fail('denied', userDeniedMessage(answer.reason))
      if (answer.decision === 'allow_always') safeCall(() => opts.onAllowAlways?.(allowKey, answer.scope ?? 'thread'))
    }
    if (ctx.signal.aborted) return fail('error', '已中断')
    return undefined
  }
  const refused = await gate(false)
  if (refused) return refused

  emitCall('running')

  // (d) PreToolUse
  const pre = await deps.hooks.run('PreToolUse', {
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    callId: call.callId,
    toolName: tool.name,
    input,
  })
  if (pre.block) return fail('error', `工具调用被 hook 拦截：${pre.block.reason}`)
  if (pre.updatedInput !== undefined) {
    const reparsed = tool.inputSchema.safeParse(pre.updatedInput)
    if (!reparsed.success) return fail('error', `hook 改写后的参数无效：${formatIssues(reparsed.error.issues)}`)
    // A hook narrows, never widens: what was approved was the old input, so a changed one is classified and
    // decided again — a higher risk or another allow key asks again (or is denied where nobody can answer).
    if (safeStringify(reparsed.data) !== safeStringify(input)) {
      input = reparsed.data
      resummarize()
      const refusedAfterHook = await gate(true)
      if (refusedAfterHook) return refusedAfterHook
      emitCall('running')
    }
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
    callId: call.callId,
    toolName: tool.name,
    input,
    output: result.content,
    isError: result.isError === true,
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
  display?: ToolSummary
  input: unknown
  risk: ToolRisk
  canAllowAlways: boolean
  allowKey: string
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

/**
 * What the model reads when the user said no. A 拒绝并说明 note is the user's own instruction for this turn, so it
 * goes back verbatim (bounded by the gate) for the model to adapt instead of retrying the same call.
 */
export function userDeniedMessage(reason?: string): string {
  return reason
    ? `${USER_DENIED_MESSAGE}。用户的说明：${reason}\n请按用户的说明调整做法，不要原样重试。`
    : USER_DENIED_MESSAGE
}

async function askApproval(a: AskArgs): Promise<ApprovalAnswer> {
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
    ...(a.display ? { display: a.display } : {}),
    ...(a.detail ? { detail: a.detail } : {}),
    input: inputJson,
    risk: a.risk,
    canAllowAlways,
    ...(canAllowAlways ? { allowKey: a.allowKey } : {}),
  })
  let answer: ApprovalAnswer
  // The user may take minutes (or come back much later): that time is not the turn's working time.
  const endWait = a.ctx.onApprovalWait?.()
  try {
    answer = await a.deps.approvals.ask(
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
    answer = { decision: 'deny' }
  } finally {
    endWait?.()
  }
  if (answer.decision === 'allow_always' && !canAllowAlways) answer = { decision: 'allow_once' }
  safeEmit(a.ctx, { type: 'approval.resolved', threadId: a.ctx.threadId, approvalId, ...answer })
  return answer
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
  let expire: () => void = () => {}
  const timeout = new Promise<never>((_, reject) => {
    expire = () => {
      timedOut = true
      ac.abort(new Error('timeout'))
      reject(new Error('timeout'))
    }
  })
  // Pausable: a nested approval (a workflow write step asking the user) is not the tool's working time.
  const clock = createTurnBudget(a.timeoutMs, () => expire())

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
    progress: (message, fraction, detail) =>
      safeEmit(a.ctx, {
        type: 'tool.progress',
        threadId: a.ctx.threadId,
        callId: a.call.callId,
        message,
        fraction,
        ...(detail !== undefined ? { detail } : {}),
      }),
    depth: a.ctx.depth,
    askUser: bindAskUser(a.deps.questions, a.ctx, a.call.callId, ac.signal),
    pauseTimeouts: () => {
      const resumeTool = clock.pause()
      const resumeTurn = a.ctx.onApprovalWait?.()
      return () => {
        resumeTool()
        resumeTurn?.()
      }
    },
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
    clock.dispose()
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
