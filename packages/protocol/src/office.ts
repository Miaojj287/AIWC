/**
 * Office platforms (飞书 / 钉钉 / 企业微信). AIWC never talks to their OpenAPI directly: every call goes
 * through the vendor's official CLI (lark-cli / dws / wecom-cli), which owns app credentials and
 * tokens on this machine. These types are what the main process, the agent tools and the renderer
 * share about that: connection status, the browser-authorization flow and table pushes.
 */

export const OFFICE_PLATFORMS = ['feishu', 'dingtalk', 'wecom'] as const
export type OfficePlatform = (typeof OFFICE_PLATFORMS)[number]

export function isOfficePlatform(value: unknown): value is OfficePlatform {
  return typeof value === 'string' && (OFFICE_PLATFORMS as readonly string[]).includes(value)
}

export type OfficeAuthState = 'authorized' | 'unauthorized' | 'expired' | 'unknown'

export interface OfficeAccount {
  /** Person the CLI acts as (飞书用户 / 钉钉用户); absent for bot-only credentials (企业微信). */
  name?: string
  /** Organisation name when the CLI reports one. */
  tenant?: string
  id?: string
}

export interface OfficePlatformStatus {
  platform: OfficePlatform
  installed: boolean
  cli: { name: string; version?: string; path?: string }
  auth: OfficeAuthState
  account?: OfficeAccount
  /** A vendor diagnostic worth showing as-is, e.g. the organisation has not enabled CLI access. */
  detail?: string
  /** False when the CLI has no logout command (企业微信). */
  canDisconnect: boolean
  checkedAt: number
}

export type OfficeConnectStepId = 'install' | 'app' | 'authorize' | 'verify'
export type OfficeStepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface OfficeConnectStep {
  id: OfficeConnectStepId
  state: OfficeStepState
  /** Raw detail from the CLI (version installed, account name…), never UI copy. */
  detail?: string
}

export interface OfficeAuthLink {
  /** 'app' = create the CLI's own app on the open platform (飞书 only); 'authorize' = grant the account. */
  purpose: 'app' | 'authorize'
  url: string
  /** The same URL as a QR code (PNG data: URL) for the vendor's mobile app. */
  qrDataUrl?: string
  userCode?: string
  expiresAt?: number
  /** True once the app handed the URL to the default browser. */
  opened: boolean
}

export type OfficeConnectState = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

export type OfficeErrorCode =
  | 'invalid_input'
  | 'cli_missing'
  | 'install_failed'
  | 'not_connected'
  | 'needs_admin'
  | 'timeout'
  | 'cancelled'
  | 'cli_error'

export interface OfficeConnectSession {
  id: string
  platform: OfficePlatform
  state: OfficeConnectState
  steps: OfficeConnectStep[]
  link?: OfficeAuthLink
  error?: { code: OfficeErrorCode; message: string; /** A command the user can run themselves. */ command?: string }
  /** Final status once the flow is done. */
  status?: OfficePlatformStatus
  /** The agent tool call that started this flow; its row in the agent panel renders the session. */
  callId?: string
  startedAt: number
  updatedAt: number
}

/** Column types every platform can represent; each adapter maps them onto its own field types. */
export const OFFICE_COLUMN_TYPES = ['text', 'number', 'date', 'select', 'multi_select', 'checkbox', 'url'] as const
export type OfficeColumnType = (typeof OFFICE_COLUMN_TYPES)[number]

export type OfficeCellValue = string | number | boolean | string[] | null

export interface OfficeTableColumn {
  name: string
  type: OfficeColumnType
}

export interface OfficePushRecord {
  id: string
  platform: OfficePlatform
  title: string
  url?: string
  mode: 'create' | 'append'
  /** Rows written by this push (not the table's total). */
  rows: number
  columns: string[]
  /** Vendor coordinates needed to append later: base token + table id, docid + sheet, baseId + tableId. */
  target: Record<string, string>
  createdAt: number
}

/** Hosts a table / document link may point at before the app offers to open it. */
export const OFFICE_RESULT_HOST_SUFFIXES: Readonly<Record<OfficePlatform, readonly string[]>> = {
  feishu: ['feishu.cn', 'larksuite.com', 'larkoffice.com'],
  dingtalk: ['dingtalk.com'],
  wecom: ['doc.weixin.qq.com', 'work.weixin.qq.com'],
}

/** True when `url` is https and its host is (a subdomain of) one of the platform's hosts. */
export function isOfficeHostUrl(platform: OfficePlatform, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return OFFICE_RESULT_HOST_SUFFIXES[platform].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}
