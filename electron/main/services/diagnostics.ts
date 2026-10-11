/**
 * 导出日志: one redacted text bundle of the app's log files, for the user to attach to a bug report.
 * Shared by the settings page (app:exportLogs) and the Help menu so both apply the same redaction.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, join } from 'node:path'
import { formatDateForFile } from './exporter'
import { createRedactor, type RedactorOptions } from './redact'

export interface DiagnosticsInput {
  appVersion: string
  /** Log files, newest first (as the rotating logger lists them). */
  files: readonly string[]
  exportsDir: string
  redaction: RedactorOptions
  platform?: string
  arch?: string
  electronVersion?: string
  /** Tests: fixed file-name stamp and readers. */
  stamp?: string
  readFile?: (path: string) => string
  writeFile?: (path: string, text: string) => void
}

/** Build the bundle text: a header, then each log file (oldest first), every line redacted. */
export function buildDiagnosticsText(input: DiagnosticsInput): string {
  const redact = createRedactor(input.redaction)
  const read = input.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const chunks = [
    `# AIWC ${input.appVersion} · ${input.platform ?? process.platform}-${input.arch ?? process.arch} · electron ${input.electronVersion ?? process.versions.electron ?? '?'}\n`,
    '# Redacted: home folder, user name, WeChat ids and folders, group ids, emails, phone numbers, keys and tokens.\n',
  ]
  for (const file of [...input.files].reverse()) {
    // Only the file name: the full path would carry the home folder before redaction gets a say.
    const name = basename(file)
    try {
      chunks.push(`\n===== ${name} =====\n`, redact(read(file)))
    } catch (error) {
      chunks.push(
        `\n===== ${name} (read failed: ${redact(error instanceof Error ? error.message : String(error))}) =====\n`,
      )
    }
  }
  return chunks.join('')
}

/** Write the redacted bundle into the exports folder and return its path. */
export function exportDiagnostics(input: DiagnosticsInput): string {
  const out = join(input.exportsDir, `aiwc-logs-${input.stamp ?? formatDateForFile()}.log`)
  const write = input.writeFile ?? ((path: string, text: string) => writeFileSync(path, text, 'utf8'))
  write(out, buildDiagnosticsText(input))
  return out
}

/** The OS user name, or undefined where there is none (no passwd entry in some containers). */
export function safeUsername(): string | undefined {
  try {
    return userInfo().username
  } catch {
    // The home-folder rule still covers paths without it.
    return undefined
  }
}

/** The running user's home folder and name, the two identifiers every log path carries. */
export function diagnosticsRedaction(): RedactorOptions {
  return { home: homedir(), username: safeUsername() }
}
