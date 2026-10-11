/**
 * The wire contract of a user hook command, modelled on Claude Code / Codex hooks so existing scripts work:
 *
 *  stdin  — one JSON object: hook_event_name, session_id (thread), turn_id, cwd, and per event tool_name /
 *           tool_input / tool_response (tool events), prompt (UserPromptSubmit), last_assistant_message (Stop).
 *  exit 0 — success. stdout may be JSON: `decision: "block"` + `reason`, `continue: false` + `stopReason`,
 *           `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason`, `hookSpecificOutput.
 *           updatedInput` (PreToolUse), `hookSpecificOutput.additionalContext`. Plain stdout of UserPromptSubmit /
 *           SessionStart is added as context.
 *  exit 2 — blocking: stderr is the reason (PreToolUse: the call is not run; UserPromptSubmit: the turn does not
 *           start; Stop: the model gets the reason and continues; PostToolUse: the reason is appended to the output).
 *  other  — a failure: logged and shown in settings, the action goes on (a hook never breaks a turn). Timeouts too.
 *
 * Hooks can only narrow what the agent does: `permissionDecision: "allow"` is ignored, approvals still apply, and
 * a changed `updatedInput` goes through the approval gate again (kernel router): a higher risk, another allow key or
 * an input the user was shown differently asks again, and is denied where nobody can answer (scheduled runs).
 */
import type { UserHookEvent, UserHookOutcome } from '@aiwc/protocol'

export const HOOK_CONTEXT_CHARS = 4_000
const MESSAGE_CHARS = 500

export interface HookExecution {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  spawnError?: string
}

export interface HookDecision {
  outcome: UserHookOutcome
  /** Stop the action with this reason (events that can block). */
  block?: string
  /** Extra context for the model (UserPromptSubmit / SessionStart). */
  context?: string
  /** Rewritten tool input (PreToolUse); the kernel re-validates it. */
  updatedInput?: Record<string, unknown>
  /** Text appended to a tool's output (PostToolUse). */
  feedback?: string
  /** What settings shows next to the hook. */
  message?: string
}

const BLOCKABLE: readonly UserHookEvent[] = ['PreToolUse', 'UserPromptSubmit', 'Stop']
const CONTEXT_EVENTS: readonly UserHookEvent[] = ['UserPromptSubmit', 'SessionStart']

const cap = (text: string, n: number): string => (text.length > n ? `${text.slice(0, n)}…` : text)
const firstLine = (text: string): string => cap(text.trim().split('\n')[0] ?? '', MESSAGE_CHARS)

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** A reason to block, turned into the effect that event supports. */
function blocking(event: UserHookEvent, reason: string): HookDecision {
  const text = cap(reason, HOOK_CONTEXT_CHARS)
  if (BLOCKABLE.includes(event)) return { outcome: 'blocked', block: text, message: firstLine(text) }
  if (event === 'PostToolUse') return { outcome: 'context', feedback: text, message: firstLine(text) }
  // SessionStart cannot block anything; say so in settings rather than pretend.
  return { outcome: 'failed', message: firstLine(text) }
}

export function interpretHookResult(event: UserHookEvent, exec: HookExecution): HookDecision {
  if (exec.spawnError) return { outcome: 'failed', message: firstLine(exec.spawnError) }
  if (exec.timedOut) return { outcome: 'timeout' }
  if (exec.exitCode === 2) return blocking(event, exec.stderr.trim() || 'blocked by hook')
  if (exec.exitCode !== 0) return { outcome: 'failed', message: firstLine(exec.stderr) || undefined }

  const out = exec.stdout.trim()
  let json: Record<string, unknown> | undefined
  if (out.startsWith('{')) {
    try {
      json = record(JSON.parse(out))
    } catch {
      json = undefined
    }
  }
  if (!json) {
    if (out && CONTEXT_EVENTS.includes(event))
      return { outcome: 'context', context: cap(out, HOOK_CONTEXT_CHARS), message: firstLine(out) }
    return { outcome: 'allowed' }
  }

  const specific = record(json.hookSpecificOutput)
  if (json.continue === false) return blocking(event, str(json.stopReason) ?? str(json.reason) ?? 'stopped by hook')
  if (event === 'PreToolUse' && specific?.permissionDecision === 'deny')
    return blocking(event, str(specific.permissionDecisionReason) ?? 'denied by hook')
  if (json.decision === 'block') return blocking(event, str(json.reason) ?? 'blocked by hook')

  const decision: HookDecision = { outcome: 'allowed' }
  const context = str(specific?.additionalContext)
  if (context) {
    if (CONTEXT_EVENTS.includes(event)) decision.context = cap(context, HOOK_CONTEXT_CHARS)
    else if (event === 'PostToolUse') decision.feedback = cap(context, HOOK_CONTEXT_CHARS)
  }
  const updated = record(specific?.updatedInput)
  if (event === 'PreToolUse' && updated) decision.updatedInput = updated
  if (decision.context || decision.feedback || decision.updatedInput) decision.outcome = 'context'
  return decision
}

/** The stdin payload; keys follow the Claude Code / Codex names. */
export function hookInput(
  event: UserHookEvent,
  payload: {
    threadId: string
    turnId?: string
    toolName?: string
    input?: unknown
    output?: unknown
    text?: string
    channel?: string
    profile?: string
  },
  cwd: string,
): string {
  const body: Record<string, unknown> = {
    hook_event_name: event,
    session_id: payload.threadId,
    cwd,
    ...(payload.turnId ? { turn_id: payload.turnId } : {}),
    ...(payload.channel ? { channel: payload.channel } : {}),
    ...(payload.profile ? { profile: payload.profile } : {}),
  }
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    body.tool_name = payload.toolName
    body.tool_input = payload.input ?? null
    if (event === 'PostToolUse') body.tool_response = payload.output ?? null
  }
  if (event === 'UserPromptSubmit') body.prompt = payload.text ?? ''
  if (event === 'Stop') body.last_assistant_message = payload.text ?? ''
  if (event === 'SessionStart') body.source = 'startup'
  return JSON.stringify(body)
}
