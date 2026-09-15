/**
 * OS-level containment for shell commands. On macOS this is the seatbelt (`sandbox-exec`) profile
 * Codex-style agents use: read anywhere, write only inside the roots the app hands out, network on.
 * A command that needs more asks for it explicitly (`escalate`), which the approval matrix turns into
 * a fresh confirmation every time. Other platforms currently run unsandboxed and say so.
 */
import { existsSync } from 'node:fs'

export interface SandboxSpec {
  /** Directories the command may create / modify files in. Everything else is read-only. */
  writableRoots: readonly string[]
  network: boolean
  /** Files the command may not even read (the app's secret store). */
  readDeny?: readonly string[]
}

export interface WrappedCommand {
  command: string
  args: string[]
}

export interface Sandbox {
  readonly kind: 'seatbelt' | 'none'
  wrap(command: string, args: readonly string[], spec: SandboxSpec): WrappedCommand
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

export function createSandbox(platform: NodeJS.Platform = process.platform): Sandbox {
  if (platform === 'darwin' && existsSync(SANDBOX_EXEC)) {
    return {
      kind: 'seatbelt',
      wrap: (command, args, spec) => ({ command: SANDBOX_EXEC, args: ['-p', seatbeltProfile(spec), command, ...args] }),
    }
  }
  return { kind: 'none', wrap: (command, args) => ({ command, args: [...args] }) }
}

const quote = (path: string): string => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Later rules win in seatbelt, so the read denials come after the blanket read allow. */
export function seatbeltProfile(spec: SandboxSpec): string {
  const writable = [...new Set(spec.writableRoots.filter(Boolean))].map((p) => `(subpath ${quote(p)})`).join(' ')
  const denyRead = (spec.readDeny ?? []).filter(Boolean).map((p) => `(literal ${quote(p)}) (subpath ${quote(p)})`).join(' ')
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow process-info*)',
    '(allow signal (target same-sandbox))',
    '(allow file-read*)',
    denyRead ? `(deny file-read* ${denyRead})` : '',
    `(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/stdout") (literal "/dev/stderr") (regex #"^/dev/tty") (regex #"^/dev/pty") (regex #"^/dev/fd/") (subpath "/private/tmp") (subpath "/private/var/folders")${writable ? ` ${writable}` : ''})`,
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm*)',
    '(allow file-ioctl)',
    '(allow pseudo-tty)',
    spec.network ? '(allow network-outbound)\n(allow network-inbound)\n(allow system-socket)' : '',
  ]
  return lines.filter(Boolean).join('\n')
}

/** The stderr line seatbelt produces when a write is refused; used to explain the failure to the model. */
export const SEATBELT_DENIED_RE = /Operation not permitted|EPERM|permission denied/i
