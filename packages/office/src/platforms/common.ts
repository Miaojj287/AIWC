/**
 * Pieces the three platform modules share: running a blocking CLI flow while publishing the link it
 * prints, and the read-only / refusal rules for the generic CLI tools.
 */
import { extractUrls } from '../cli/output'
import { assertOk, OfficeError, type CliRunner } from '../cli/runner'
import type { RunResult } from '@aiwc/shell'
import type { AuthLinkInput, ConnectHooks } from './types'

export function hostMatches(url: string, suffixes: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return suffixes.some((s) => host === s || host.endsWith(`.${s}`))
  } catch {
    return false
  }
}

export interface LinkedRunOptions {
  purpose: AuthLinkInput['purpose']
  hostSuffixes: readonly string[]
  timeoutMs: number
  /** The link to use as soon as it appears (e.g. the one with the code already filled in). */
  prefer?: (urls: string[]) => string | undefined
  /** When only non-preferred links have appeared, wait this long for the preferred one before falling back. */
  settleMs?: number
  userCode?: (output: string, url: string) => string | undefined
  expiresInSec?: (output: string) => number | undefined
  cwd?: string
  /** Hold the link until the output shows this (bounded by settleMs), e.g. "QR PNG written". */
  ready?: (output: string) => boolean
  /** Extra link fields resolved when the link is published (e.g. read the CLI's QR PNG). */
  enrich?: (
    url: string,
    output: string,
  ) => Promise<Partial<Pick<AuthLinkInput, 'qrDataUrl' | 'userCode' | 'expiresInSec'>>>
}

/**
 * Run a CLI that blocks until the user finishes in the browser (config init --new, dws auth login
 * --device, wecom-cli auth init). The link it prints becomes the session's link while the process keeps
 * waiting — the preferred one if it shows up, otherwise the first acceptable one — and is cleared when
 * the process ends.
 */
export async function runLinkedFlow(
  cli: CliRunner,
  args: readonly string[],
  hooks: ConnectHooks,
  opts: LinkedRunOptions,
): Promise<RunResult> {
  let output = ''
  let published = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()
  const publish = (fallback: boolean) => {
    if (published) return
    const allowed = extractUrls(output).filter((u) => hostMatches(u, opts.hostSuffixes))
    if (allowed.length === 0) return
    const preferred = opts.prefer?.(allowed)
    const waiting = (opts.prefer && !preferred) || (opts.ready && !opts.ready(output))
    if (waiting && !fallback && opts.settleMs) {
      settleTimer ??= setTimeout(() => publish(true), opts.settleMs)
      return
    }
    const url = preferred ?? allowed[0]
    if (!url) return
    published = true
    if (settleTimer) clearTimeout(settleTimer)
    const snapshot = output
    pending = (async () => {
      const extra = opts.enrich ? await opts.enrich(url, snapshot).catch(() => ({})) : {}
      await hooks.link({
        purpose: opts.purpose,
        url,
        userCode: opts.userCode?.(snapshot, url),
        expiresInSec: opts.expiresInSec?.(snapshot),
        ...extra,
      })
    })()
  }
  const result = await cli.run(args, {
    signal: hooks.signal,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    onOutput: (chunk) => {
      output += chunk
      publish(false)
    },
  })
  if (settleTimer) clearTimeout(settleTimer)
  await pending.catch(() => {})
  hooks.clearLink()
  if (result.aborted) throw new OfficeError('cancelled', '已取消')
  if (result.timedOut) throw new OfficeError('timeout', '等待浏览器授权超时，请重新连接')
  if (!published && result.code !== 0) assertOk(cli.name, args, result)
  return result
}

/** `user_code=ABCD-EFGH` in a verification URL. */
export function userCodeInUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('user_code') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * The command path of an argv: the words before the first flag (`aitable record query`,
 * `base +record-list`). Flag values are never part of it, so `--title remove-old` cannot look like
 * a delete. An argv that starts with a flag has no command path — callers treat that as not read-only.
 */
export function commandWords(args: readonly string[]): string[] {
  const words: string[] = []
  for (const arg of args) {
    if (arg.startsWith('-')) break
    words.push(arg)
  }
  return words
}

export const startsWithFlag = (args: readonly string[]): boolean => Boolean(args[0]?.startsWith('-'))

export const REFUSE_LEADING_FLAG = '把子命令写在 args 最前面，全局参数放在后面'

export const hasHelpFlag = (args: readonly string[]): boolean => args.some((a) => a === '--help' || a === '-h')
export const hasDryRun = (args: readonly string[]): boolean => args.includes('--dry-run')

const READ_VERB =
  /(?:^|[-_+])(list|get|search|query|fetch|resolve|info|detail|status|show|scopes|check|categories|agenda|history|options|stats|preview|whoami|version|doctor)$/i
const DELETE_VERB =
  /(?:^|[-_+])(delete|remove|clear|purge|destroy|revoke|disable|logout|reset|recall|withdraw)(?:[-_]|$)/i

export function isReadVerb(word: string | undefined): boolean {
  return Boolean(word && READ_VERB.test(word))
}

export function isDeleteVerb(word: string | undefined): boolean {
  return Boolean(word && DELETE_VERB.test(word))
}

export const REFUSE_CREDENTIALS = '账号授权和凭证管理走 office_connect；直接改 CLI 的 auth / config / profile 需要用户逐次确认'
export const REFUSE_DELETE = '删除 / 撤回类操作不可恢复，每次都要用户确认'
export const REFUSE_DAEMON = '常驻监听 / 自更新类命令会长期占用或改变 CLI 本身'
