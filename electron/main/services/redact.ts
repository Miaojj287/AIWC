/**
 * Redaction for text that leaves the app on the user's behalf (diagnostic log bundles, Agent thread
 * exports). It removes what identifies the user or unlocks their data — the home folder and OS user name,
 * WeChat account ids and data-folder names, group ids, emails, phone numbers, keys, tokens and signed URL
 * parameters — and keeps everything needed to read a log (timestamps, scopes, error text, relative paths).
 *
 * Patterns are deliberately broad: a false positive costs a placeholder in a log line, a false negative
 * leaks an identifier into a file the user may post publicly.
 */

export interface RedactorOptions {
  /** os.homedir(): replaced by `~` (both slash styles). */
  home?: string
  /** os.userInfo().username: replaced wherever it appears as its own word. */
  username?: string
  /** Exact secret values known at export time (revealed keys); each becomes `<secret>`. */
  secrets?: readonly string[]
}

/** Placeholders. Exported so tests and callers can assert on them without retyping. */
export const REDACTED = {
  home: '~',
  user: '<user>',
  wxid: 'wxid_<redacted>',
  account: '<account>',
  group: '<group>',
  email: '<email>',
  phone: '<phone>',
  secret: '<secret>',
  hex: '<hex>',
} as const

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Names under which a value is a credential: `token=…`, `"apiKey": "…"`, `Authorization: Bearer …`. Group 1 is the
 * name and separator (kept), the rest the value. Shared with the model call log (ai/redact.ts): one definition.
 */
const SECRET_FIELD =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie|db[_-]?key|xor[_-]?key|aes[_-]?key)["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|digest|token)\s+)?[^\s"',;&}]{4,}/gi
/** A Cookie / Set-Cookie header carries several `name=value` pairs: everything up to the end of the value goes. */
const COOKIE_FIELD = /((?:set-)?cookie["']?\s*[:=]\s*["']?)[^"'\r\n}]{4,}/gi
/** Credential fields in redaction order (cookie first: its value spans `;`). Each keeps group 1. */
export const SECRET_FIELD_PATTERNS: readonly RegExp[] = [COOKIE_FIELD, SECRET_FIELD]
const BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
/** Signed or authenticated URL parameters. */
const URL_SECRET_PARAM =
  /([?&#](?:[a-z_]*token|key|sig|signature|auth|code|ticket|session|sessionid|pass_ticket|secret)=)[^&#\s"'<>]+/gi
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
/** Provider-style keys: sk-…, sk-ant-…, AKIA…, ghp_… */
const API_KEY = /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,})\b/g
/** 32+ hex chars: database / image keys, account-folder hashes, salts. */
const LONG_HEX = /\b[0-9a-fA-F]{32,}\b/g
const WXID = /\bwxid_[A-Za-z0-9_-]+/g
/** Group ids: `123456@chatroom`, `123@im.chatroom` (case-insensitive like isGroupChatId). */
const GROUP_ID = /\b[A-Za-z0-9_-]+@(im\.)?chatroom\b/gi
/**
 * WeChat's per-account data folders: the folder name is the account id (or a custom alias of it). Separators may be
 * doubled: the log writes metadata through JSON.stringify (`D:\\xwechat_files\\zhangsan88_8f2a`).
 */
const WECHAT_ACCOUNT_DIR = /((?:xwechat_files|WeChat Files|wechat_files)[\\/]+)[^\\/\s"'<>]+/gi
/** One or more path separators of either style (a JSON-escaped Windows path doubles each backslash). */
const SEP = '[\\\\/]+'
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
/** Mainland mobile numbers (with optional +86) and other E.164 numbers. */
const PHONE = /(?<![\d.])(?:(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}|\+\d{8,15})(?![\d.])/g

/** Build a redactor for one export. Pure: same options, same output. */
export function createRedactor(options: RedactorOptions = {}): (text: string) => string {
  const literals: [RegExp, string][] = []
  for (const secret of options.secrets ?? []) {
    if (secret.length >= 6) literals.push([new RegExp(escapeRegExp(secret), 'g'), REDACTED.secret])
  }
  const home = options.home?.replace(/[\\/]+$/, '')
  if (home && home.length > 1) {
    // Either slash style, single or JSON-doubled; never a longer sibling (`/Users/li` is not `/Users/lisa`).
    const body = home
      .split(/[\\/]+/)
      .map(escapeRegExp)
      .join(SEP)
    literals.push([new RegExp(`${body}(?![A-Za-z0-9_.-])`, 'gi'), REDACTED.home])
  }
  const user = options.username?.trim()
  // Very short names ("a", "me") would shred ordinary words: those are replaced only as a whole path segment
  // (`D:\\li\\x`, `/home/li/`); the home-dir rule covers their home folder.
  const userPattern = !user
    ? undefined
    : user.length >= 3
      ? new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(user)}(?![A-Za-z0-9_])`, 'gi')
      : new RegExp(`(?<=[\\\\/])${escapeRegExp(user)}(?=[\\\\/]|["'\\s,;)\\]}]|$)`, 'gi')

  return (text: string): string => {
    let out = text
    for (const [pattern, replacement] of literals) out = out.replace(pattern, replacement)
    if (userPattern) out = out.replace(userPattern, REDACTED.user)
    out = out
      .replace(JWT, REDACTED.secret)
      .replace(API_KEY, REDACTED.secret)
      .replace(BEARER, `$1${REDACTED.secret}`)
      .replace(COOKIE_FIELD, `$1${REDACTED.secret}`)
      .replace(SECRET_FIELD, `$1${REDACTED.secret}`)
      .replace(URL_SECRET_PARAM, `$1${REDACTED.secret}`)
      .replace(WECHAT_ACCOUNT_DIR, `$1${REDACTED.account}`)
      .replace(WXID, REDACTED.wxid)
      .replace(GROUP_ID, (_match, im: string | undefined) => `${REDACTED.group}@${im ?? ''}chatroom`)
      .replace(EMAIL, REDACTED.email)
      .replace(PHONE, REDACTED.phone)
      .replace(LONG_HEX, REDACTED.hex)
    return out
  }
}
