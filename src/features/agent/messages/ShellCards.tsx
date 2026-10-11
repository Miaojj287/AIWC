/**
 * The `shell` tool in the transcript: the approval shows the exact command line (plus why it was
 * graded the way it was), and the expanded row shows the command with its output like a terminal
 * would — exit code, stdout, stderr — instead of a JSON blob.
 */
import { useT } from '@/i18n'
import { cn } from '@/kit'
import type { ApprovalBodyProps, ToolCardProps } from '../toolCards'

interface ShellInputLike {
  command: string
  cwd?: string
  escalate?: boolean
  reason?: string
}

interface ShellOutputLike {
  ok?: boolean
  exitCode?: number | null
  stdout?: string
  stderr?: string
  durationMs?: number
  cwd?: string
  sandboxed?: boolean
  timedOut?: boolean
  truncated?: boolean
  hint?: string
  error?: string
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

function shellInput(value: unknown): ShellInputLike | undefined {
  const r = record(value)
  return r && typeof r.command === 'string' ? (r as unknown as ShellInputLike) : undefined
}

export function ShellApprovalBody({ request }: ApprovalBodyProps) {
  const t = useT()
  const input = shellInput(request.input)
  if (!input) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-item border border-line-6 bg-panel px-2.5 py-2">
      <pre className="m-0 max-h-[132px] overflow-auto whitespace-pre-wrap break-all font-mono text-micro leading-4 text-fg select-text">
        <span className="text-fg-3">$ </span>
        {input.command}
      </pre>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-fg-3">
        {input.cwd ? (
          <span className="font-mono truncate max-w-full" title={input.cwd}>
            {input.cwd}
          </span>
        ) : null}
        {input.escalate ? (
          <span className="text-warn-ink">
            {input.reason ? t('agent.shell.unsandboxed', { reason: input.reason }) : t('agent.shell.ranUnsandboxed')}
          </span>
        ) : null}
        {request.detail ? <span>{request.detail}</span> : null}
      </div>
    </div>
  )
}

export function ShellCard({ call }: ToolCardProps) {
  const t = useT()
  const input = shellInput(call.input)
  const out = record(call.output) as ShellOutputLike | undefined
  if (!input || call.status === 'pending' || call.status === 'awaiting_approval') return null
  const failed = out ? out.ok === false : call.isError
  const stdout = (out?.stdout ?? '').trimEnd()
  const stderr = (out?.stderr ?? '').trimEnd()
  const error = typeof out?.error === 'string' ? out.error : typeof call.output === 'string' ? call.output : undefined
  return (
    <div
      className="flex flex-col gap-2 rounded-item border border-line-8 bg-panel px-3 py-2.5"
      data-testid="shell-card"
    >
      <pre className="m-0 min-w-0 whitespace-pre-wrap break-all font-mono text-micro leading-4 text-fg select-text">
        <span className="text-fg-3">$ </span>
        {input.command}
      </pre>
      {stdout ? <Output text={stdout} /> : null}
      {stderr ? <Output text={stderr} tone="danger" /> : null}
      {error && !stdout && !stderr ? <Output text={error} tone="danger" /> : null}
      {out || call.status === 'error' || call.status === 'denied' || call.status === 'timeout' ? (
        <div className="flex flex-wrap items-center gap-x-3 text-micro text-fg-3">
          {out?.exitCode !== undefined && out?.exitCode !== null ? (
            <span className={cn('font-latin', failed ? 'text-danger-ink' : undefined)}>
              {t('agent.shell.exitCode', { code: out.exitCode })}
            </span>
          ) : null}
          {out?.timedOut ? <span className="text-warn-ink">{t('agent.shell.timedOut')}</span> : null}
          {out?.sandboxed === false ? <span className="text-warn-ink">{t('agent.shell.ranUnsandboxed')}</span> : null}
          {out?.truncated ? <span>{t('agent.shell.truncated')}</span> : null}
          {call.status === 'denied' ? <span>{t('agent.tool.status.denied')}</span> : null}
        </div>
      ) : null}
      {out?.hint ? <div className="text-micro leading-4 text-fg-3">{out.hint}</div> : null}
    </div>
  )
}

function Output({ text, tone }: { text: string; tone?: 'danger' }) {
  return (
    <pre
      className={cn(
        'm-0 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-control bg-line-4 px-2 py-1.5 font-mono text-micro leading-4 select-text',
        tone === 'danger' ? 'text-danger-ink' : 'text-fg-2',
      )}
    >
      {text}
    </pre>
  )
}
