/**
 * What each platform module (feishu / dingtalk / wecom) implements. The service owns sessions, links,
 * QR codes, the browser and history; a platform module only knows its CLI's commands and outputs.
 */
import type {
  OfficeAccount,
  OfficeAuthState,
  OfficeConnectStepId,
  OfficePlatform,
  OfficeStepState,
} from '@aiwc/protocol'
import type { CliRunner } from '../cli/runner'
import type { NormalizedTable } from '../push/table'

export interface PlatformSpec {
  platform: OfficePlatform
  /** Product name used in model-facing text. */
  label: string
  /** The platform's table product, e.g. 多维表格. */
  tableNoun: string
  bin: string
  npmPackage: string
  /** Shown to the user when installation has to happen by hand. */
  installCommand: string
  /** An authorization link must be https on one of these hosts before it is opened in the browser. */
  authHostSuffixes: readonly string[]
  /** Steps this platform's connect flow walks through, in order. */
  steps: readonly OfficeConnectStepId[]
  /** Whether the CLI can log out (企业微信's cannot). */
  canDisconnect: boolean
}

export interface AuthProbe {
  auth: OfficeAuthState
  account?: OfficeAccount
  detail?: string
  /** 飞书 only: whether the CLI already has its own app (config init done). */
  appConfigured?: boolean
}

export interface AuthLinkInput {
  purpose: 'app' | 'authorize'
  url: string
  userCode?: string
  expiresInSec?: number
  /** The CLI's own QR when it encodes something other than `url` (企业微信's bot-binding URL). */
  qrDataUrl?: string
}

export interface ConnectHooks {
  signal: AbortSignal
  /** Private scratch dir for this flow (cwd for files a CLI writes, e.g. a QR PNG); removed afterwards. */
  workDir: string
  step(id: OfficeConnectStepId, state: OfficeStepState, detail?: string): void
  /** Publish a browser link: validated, QR-encoded, opened in the default browser. */
  link(link: AuthLinkInput): Promise<void>
  clearLink(): void
}

export interface ConnectOptions {
  /** Run the account authorization even when the CLI already reports a valid login. */
  reauthorize: boolean
  /** 飞书: business domains to request (incremental authorization). */
  domains?: readonly string[]
}

export interface PushContext {
  cli: CliRunner
  signal: AbortSignal
  progress(message: string, fraction?: number): void
  /** Private scratch dir (cwd of every call) for `@file` payloads. */
  workDir: string
  /** Write a payload file into workDir; CLIs only accept relative `@file` paths under their cwd. */
  writeFile(name: string, content: string): Promise<void>
}

export interface PushOutcome {
  url?: string
  title: string
  mode: 'create' | 'append'
  rowsWritten: number
  /** Coordinates needed to append to the same table later. */
  target: Record<string, string>
  warnings: string[]
}

export interface AppendTarget {
  url?: string
  /** Coordinates recorded by an earlier push. */
  coords?: Record<string, string>
  /** Sub-table / sheet name to append to; defaults to the first one. */
  sheetName?: string
}

export interface CommandPolicy {
  /** Only reads: help, schema, bundled skill docs, list / get / search / query. */
  isReadOnly(args: readonly string[]): boolean
  /** Why the generic CLI tool must not run these args (credential management, self-update, daemons, deletions). */
  refusal(args: readonly string[]): string | undefined
}

export interface PlatformModule extends CommandPolicy {
  spec: PlatformSpec
  probe(cli: CliRunner, signal?: AbortSignal): Promise<AuthProbe>
  connect(cli: CliRunner, hooks: ConnectHooks, opts: ConnectOptions): Promise<void>
  disconnect(cli: CliRunner): Promise<void>
  createTable(ctx: PushContext, table: NormalizedTable): Promise<PushOutcome>
  appendTable(ctx: PushContext, table: NormalizedTable, target: AppendTarget): Promise<PushOutcome>
}
