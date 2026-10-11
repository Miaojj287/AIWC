/**
 * Network settings for requests to model providers (设置 › AI 接入 › 网络): follow the system proxy, a proxy typed
 * by hand (http / https / socks5), or none, plus addresses that never go through the proxy. Loopback hosts (Ollama
 * and other local models) are always reached directly. Pure: the schema, URL validation and bypass matching are
 * shared by the settings form and the main-process fetch layer.
 */
import { z } from 'zod'

export const ProxyModeSchema = z.enum(['system', 'manual', 'off'])
export type ProxyMode = z.infer<typeof ProxyModeSchema>

/** The proxy password never lives in config.json: it is stored in the secret store under this ref. */
export const PROXY_PASSWORD_SECRET_REF = 'ai.proxy.password'

export const PROXY_URL_MAX_CHARS = 512
export const PROXY_BYPASS_MAX_RULES = 200

export const ProxyConfigSchema = z.object({
  /** An unknown mode written by a newer build falls back to following the system. */
  mode: ProxyModeSchema.catch('system').default('system'),
  /** Manual mode: `http://host:port`, `https://host:port` or `socks5://host:port` (no credentials in the URL). */
  url: z.string().max(PROXY_URL_MAX_CHARS).optional(),
  /** Manual mode: optional proxy user; the password is in the secret store (`passwordRef`). */
  username: z.string().max(256).optional(),
  passwordRef: z.string().optional(),
  /** Hosts that skip the proxy: `example.com`, `*.example.com`, `.example.com`, `host:port`, `10.0.0.0/8`, `<local>`. */
  bypass: z.array(z.string().max(256)).max(PROXY_BYPASS_MAX_RULES).default([]).catch([]),
})
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>

/** 调用记录: metadata of every model call is always kept locally; request / response content only while this is on. */
export const CallLogConfigSchema = z.object({ recordContent: z.boolean().default(false) })

export type ProxyScheme = 'http' | 'https' | 'socks5' | 'socks5h'

export type ProxyUrlCheck =
  | { ok: true; scheme: ProxyScheme; host: string; port: number; /** `scheme://host:port` */ normalized: string }
  | { ok: false; code: 'empty' | 'invalid' | 'scheme' | 'credentials' | 'port' }

const DEFAULT_PORTS: Record<ProxyScheme, number> = { http: 80, https: 443, socks5: 1080, socks5h: 1080 }

/** Validate a manual proxy URL. A bare `host:port` means http. Credentials belong in the username / password fields. */
export function parseProxyUrl(raw: string | undefined): ProxyUrlCheck {
  const value = raw?.trim() ?? ''
  if (!value) return { ok: false, code: 'empty' }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, code: 'invalid' }
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'socks5' && scheme !== 'socks5h')
    return { ok: false, code: 'scheme' }
  if (url.username || url.password) return { ok: false, code: 'credentials' }
  if (!url.hostname || (url.pathname && url.pathname !== '/') || url.search || url.hash)
    return { ok: false, code: 'invalid' }
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[scheme]
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return { ok: false, code: 'port' }
  const host = url.hostname
  return { ok: true, scheme, host, port, normalized: `${scheme}://${host}:${port}` }
}

/** Split the bypass textarea (commas, semicolons, whitespace or new lines) into trimmed, de-duplicated rules. */
export function parseBypassList(text: string): string[] {
  const rules = text
    .split(/[\s,;]+/)
    .map((r) => r.trim())
    .filter(Boolean)
  return [...new Set(rules)].slice(0, PROXY_BYPASS_MAX_RULES)
}

const stripBrackets = (host: string): string => host.replace(/^\[|\]$/g, '').toLowerCase()

/** localhost, *.localhost, 127.0.0.0/8, ::1 and 0.0.0.0 — always reached without a proxy. */
export function isLoopbackHost(hostname: string): boolean {
  const host = stripBrackets(hostname)
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

function ipv4ToInt(host: string): number | undefined {
  const parts = host.split('.')
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const n = Number(part)
    if (n > 255) return undefined
    value = value * 256 + n
  }
  return value
}

function matchesCidr(host: string, rule: string): boolean {
  const [base = '', bitsText = ''] = rule.split('/')
  const bits = Number(bitsText)
  const ip = ipv4ToInt(host)
  const net = ipv4ToInt(base)
  if (ip === undefined || net === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const size = 2 ** (32 - bits)
  return Math.floor(ip / size) === Math.floor(net / size)
}

function matchesRule(host: string, port: string, rawRule: string): boolean {
  const rule = rawRule
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, '')
  if (!rule) return false
  if (rule === '*') return true
  if (rule === '<local>') return !host.includes('.') && !host.includes(':')
  if (rule.includes('/')) return matchesCidr(host, rule)
  // `host:port` (an IPv6 literal must be bracketed to carry a port)
  const portMatch = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(rule)
  const ruleHost = stripBrackets(portMatch?.[1] ?? rule)
  const rulePort = portMatch?.[2]
  if (rulePort && rulePort !== port) return false
  if (ruleHost.startsWith('*.')) return host.endsWith(ruleHost.slice(1))
  if (ruleHost.startsWith('.')) return host === ruleHost.slice(1) || host.endsWith(ruleHost)
  if (ruleHost.startsWith('*')) return host.endsWith(ruleHost.slice(1))
  return host === ruleHost
}

/** Does `url` skip the proxy? Loopback always does; otherwise the user's bypass rules decide. */
export function bypassesProxy(url: string | URL, rules: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  } catch {
    return true
  }
  const host = stripBrackets(parsed.hostname)
  if (isLoopbackHost(host)) return true
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return rules.some((rule) => matchesRule(host, port, rule))
}

/**
 * Parse one entry of a PAC / Chromium `resolveProxy` answer (`PROXY host:port; SOCKS5 host:port; DIRECT`) into a
 * proxy URL, taking the first usable entry. `undefined` = connect directly.
 */
export function proxyFromPacResult(result: string): string | undefined {
  for (const entry of result.split(';')) {
    const [kind = '', target = ''] = entry.trim().split(/\s+/)
    const upper = kind.toUpperCase()
    if (upper === 'DIRECT') return undefined
    if (!target) continue
    if (upper === 'PROXY' || upper === 'HTTP') return `http://${target}`
    if (upper === 'HTTPS') return `https://${target}`
    // Plain `SOCKS` is SOCKS4, which the fetch layer cannot speak: try the next entry instead.
    if (upper === 'SOCKS5') return `socks5://${target}`
  }
  return undefined
}
