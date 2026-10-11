/**
 * Extensions contract: MCP servers, user command hooks and the workflow progress view. Configuration lives in its
 * own file (`<dataRoot>/extensions.json`), never in AppConfig: it names commands the app will run, so it is only
 * written through the dedicated `mcp:*` / `hooks:*` channels, which validate here and confirm new commands natively.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------------------------

/** Server ids become the namespace of tool names (`mcp__<id>__<tool>`), so they are short and tool-name safe. */
export const MCP_SERVER_ID_PATTERN = /^[a-z][a-z0-9_]{0,19}$/
export const MCP_TOOL_PREFIX = 'mcp__'
export const MCP_DEFAULT_TIMEOUT_MS = 120_000
export const MCP_MAX_SERVERS = 32

/** stdio = a local command speaking MCP on stdin/stdout; http = Streamable HTTP; sse = the legacy HTTP + SSE transport. */
export const McpTransportSchema = z.enum(['stdio', 'http', 'sse'])
export type McpTransport = z.infer<typeof McpTransportSchema>

/** What the user says a server's tools do; decides the approval matrix row (destructive is only ever raised to). */
export const McpToolRiskSchema = z.enum(['read', 'write', 'send'])
export type McpToolRisk = z.infer<typeof McpToolRiskSchema>

/** Env var names (stdio) or HTTP header names (http / sse). Values live in the secret store. */
export const MCP_SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/

/**
 * Env names a stdio server's secrets may not set: each changes which program runs or what it loads (search
 * and loader paths, interpreter startup hooks, package registries, the home dir its tool configs come from),
 * so a secret could change the confirmed command without a new confirmation. Windows env names are
 * case-insensitive, so the comparison is too.
 */
const RESERVED_MCP_ENV_NAMES = new Set([
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'SHELL',
  'COMSPEC',
  'ENV',
  'BASH_ENV',
  'ZDOTDIR',
  'PROMPT_COMMAND',
  'IFS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_REPL_EXTERNAL_MODULE',
  'ELECTRON_RUN_AS_NODE',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'PYTHONUSERBASE',
  'PYTHONEXECUTABLE',
  'PERL5OPT',
  'PERL5LIB',
  'PERLLIB',
  'PERL5DB',
  'RUBYOPT',
  'RUBYLIB',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'CLASSPATH',
  'GCONV_PATH',
  'LUA_INIT',
  'LUA_PATH',
  'LUA_CPATH',
])
/** Whole families: dynamic loaders, package-manager config (registry, script shell), git's exec hooks. */
const RESERVED_MCP_ENV_PREFIXES = ['DYLD_', 'LD_', 'NPM_CONFIG_', 'YARN_', 'PNPM_', 'UV_', 'PIP_', 'GIT_']

export function isReservedMcpEnvName(name: string): boolean {
  const upper = name.trim().toUpperCase()
  return RESERVED_MCP_ENV_NAMES.has(upper) || RESERVED_MCP_ENV_PREFIXES.some((p) => upper.startsWith(p))
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** https anywhere; plain http only to this machine (a token in a header must not cross the network in clear). */
export function isAllowedMcpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)
}

const McpServerBase = z.object({
  id: z.string().regex(MCP_SERVER_ID_PATTERN),
  label: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  transport: McpTransportSchema,
  command: z.string().trim().max(1000).default(''),
  args: z.array(z.string().max(2000)).max(64).default([]),
  cwd: z.string().trim().max(1000).optional(),
  url: z.string().trim().max(2000).default(''),
  defaultRisk: McpToolRiskSchema.default('write'),
  /** Per-tool overrides keyed by the server's own tool name. */
  toolRisk: z.record(z.string().max(128), McpToolRiskSchema).default({}),
  disabledTools: z.array(z.string().max(128)).max(500).default([]),
  timeoutMs: z.number().int().min(5_000).max(600_000).default(MCP_DEFAULT_TIMEOUT_MS),
})

const refineTransport = (
  value: { transport: McpTransport; command: string; url: string; cwd?: string },
  ctx: z.RefinementCtx,
) => {
  if (value.transport === 'stdio') {
    if (!value.command) ctx.addIssue({ code: 'custom', path: ['command'], message: 'command_required' })
    if (value.cwd && !isAbsolutePathLike(value.cwd))
      ctx.addIssue({ code: 'custom', path: ['cwd'], message: 'cwd_not_absolute' })
  } else if (!isAllowedMcpUrl(value.url)) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'url_invalid' })
  }
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

export const McpSecretEntrySchema = z.object({
  name: z.string().regex(MCP_SECRET_NAME_PATTERN),
  ref: z.string().min(1).max(128),
})

/** stdio secrets become env vars of the spawned command: none may redirect what it runs (isReservedMcpEnvName). */
const refineSecretNames = (
  value: { transport: McpTransport; secrets: ReadonlyArray<{ name: string }> },
  ctx: z.RefinementCtx,
) => {
  if (value.transport !== 'stdio') return
  value.secrets.forEach((s, i) => {
    if (isReservedMcpEnvName(s.name))
      ctx.addIssue({ code: 'custom', path: ['secrets', i, 'name'], message: 'secret_name_reserved' })
  })
}

export const McpServerConfigSchema = McpServerBase.extend({
  secrets: z.array(McpSecretEntrySchema).max(32).default([]),
})
  .superRefine(refineTransport)
  .superRefine(refineSecretNames)
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

/** What 设置 › 扩展 sends on save: secret values only when the user typed a new one (absent = keep the stored value). */
export const McpServerDraftSchema = McpServerBase.extend({
  /** The id being edited; absent for a new server. Renaming an id re-registers its tools. */
  originalId: z.string().regex(MCP_SERVER_ID_PATTERN).optional(),
  secrets: z
    .array(z.object({ name: z.string().regex(MCP_SECRET_NAME_PATTERN), value: z.string().max(8000).optional() }))
    .max(32)
    .default([]),
})
  .superRefine(refineTransport)
  .superRefine(refineSecretNames)
export type McpServerDraft = z.input<typeof McpServerDraftSchema>

export type McpServerState = 'disabled' | 'connecting' | 'ready' | 'error'
/** Stable failure codes; the UI maps them to copy, `error` carries the raw detail (stderr tail, server message). */
export type McpErrorCode = 'spawn_failed' | 'exited' | 'timeout' | 'http' | 'protocol' | 'missing_secret'

export interface McpToolView {
  /** The server's own tool name. */
  name: string
  /** What the model calls it: `mcp__<server>__<tool>`. */
  toolName: string
  description: string
  /** Effective risk after the user's overrides and the server's destructive hint. */
  risk: McpToolRisk | 'destructive'
  /** The user's per-tool override, if any. */
  override?: McpToolRisk
  declaredReadOnly?: boolean
  declaredDestructive?: boolean
  disabled: boolean
}

export interface McpServerStatus {
  id: string
  state: McpServerState
  errorCode?: McpErrorCode
  error?: string
  serverName?: string
  serverVersion?: string
  tools: McpToolView[]
  updatedAt: number
}

export type McpServerView = Omit<McpServerConfig, 'secrets'> & {
  secrets: Array<{ name: string; hasValue: boolean }>
  status: McpServerStatus
}

// ---------------------------------------------------------------------------------------------
// User command hooks
// ---------------------------------------------------------------------------------------------

/** The kernel events a user hook can run on (Claude Code / Codex names, so existing scripts read the same payload). */
export const USER_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
export const UserHookEventSchema = z.enum(USER_HOOK_EVENTS)
export type UserHookEvent = z.infer<typeof UserHookEventSchema>
/** Events whose hooks are filtered by `matcher` on the tool name. */
export const TOOL_HOOK_EVENTS: readonly UserHookEvent[] = ['PreToolUse', 'PostToolUse']

export const USER_HOOK_ID_PATTERN = /^hk_[A-Za-z0-9_-]{4,32}$/
export const USER_HOOK_DEFAULT_TIMEOUT_MS = 60_000
export const USER_HOOK_MAX = 50

/** `''` or `*` matches every tool; anything else is a regular expression anchored on the whole tool name. */
export function compileHookMatcher(matcher: string): RegExp | undefined {
  const m = matcher.trim()
  if (!m || m === '*') return /^.*$/
  try {
    return new RegExp(`^(?:${m})$`)
  } catch {
    return undefined
  }
}

const UserHookBase = z.object({
  label: z.string().trim().max(60).default(''),
  enabled: z.boolean().default(true),
  event: UserHookEventSchema,
  matcher: z.string().trim().max(200).default(''),
  command: z.string().trim().min(1).max(4000),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(USER_HOOK_DEFAULT_TIMEOUT_MS),
  /** Run inside the shell tool's sandbox (writes limited to the workspace and temp dirs) where the OS has one. */
  sandbox: z.boolean().default(true),
})

const refineMatcher = (value: { matcher: string }, ctx: z.RefinementCtx) => {
  if (!compileHookMatcher(value.matcher))
    ctx.addIssue({ code: 'custom', path: ['matcher'], message: 'matcher_invalid' })
}

export const UserHookConfigSchema = UserHookBase.extend({ id: z.string().regex(USER_HOOK_ID_PATTERN) }).superRefine(
  refineMatcher,
)
export type UserHookConfig = z.infer<typeof UserHookConfigSchema>

export const UserHookDraftSchema = UserHookBase.extend({
  id: z.string().regex(USER_HOOK_ID_PATTERN).optional(),
}).superRefine(refineMatcher)
export type UserHookDraft = z.input<typeof UserHookDraftSchema>

/** allowed = ran, no opinion · blocked = stopped the action · context = added context / rewrote · failed / timeout = ignored. */
export type UserHookOutcome = 'allowed' | 'blocked' | 'context' | 'failed' | 'timeout'

export interface UserHookRunSummary {
  at: number
  outcome: UserHookOutcome
  exitCode: number | null
  durationMs: number
  /** The block reason, or the first line of stderr for a failure (bounded). */
  message?: string
}

export type UserHookView = UserHookConfig & { lastRun?: UserHookRunSummary }

export interface UserHookTestResult extends UserHookRunSummary {
  stdout: string
  stderr: string
}

/** A save either lands, or the user declined the native "run this command?" confirmation. */
export type ExtensionSaveResult<T> = { ok: true; value: T } | { ok: false; reason: 'not_confirmed' }

/** On-disk shape of `<dataRoot>/extensions.json`. Unknown or broken entries are dropped one by one, never the file. */
export const ExtensionsFileSchema = z.object({
  version: z.literal(1).default(1),
  mcpServers: z.array(z.unknown()).default([]),
  hooks: z.array(z.unknown()).default([]),
})

// ---------------------------------------------------------------------------------------------
// Workflow (workflow_run tool) progress view
// ---------------------------------------------------------------------------------------------

export const WorkflowStepStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped', 'cancelled'])
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>
/** Stable reasons a step did not finish; the panel maps them to copy. */
export const WorkflowStepErrorSchema = z.enum([
  'failed',
  'timeout',
  'step_cap',
  'invalid_json',
  'dependency_failed',
  'cancelled',
])
export type WorkflowStepError = z.infer<typeof WorkflowStepErrorSchema>

export const WorkflowRunViewSchema = z.object({
  kind: z.literal('workflow'),
  title: z.string(),
  status: z.enum(['running', 'done', 'partial', 'failed', 'cancelled']),
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      mode: z.enum(['read', 'write']),
      status: WorkflowStepStatusSchema,
      dependsOn: z.array(z.string()).optional(),
      error: WorkflowStepErrorSchema.optional(),
      durationMs: z.number().optional(),
      output: z.string().optional(),
    }),
  ),
})
export type WorkflowRunView = z.infer<typeof WorkflowRunViewSchema>

/** The workflow card's data from a progress detail or the recorded output (an object, or its JSON text). */
export function parseWorkflowView(value: unknown): WorkflowRunView | undefined {
  let raw = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  const parsed = WorkflowRunViewSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}
